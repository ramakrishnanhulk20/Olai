import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type AccountState,
  type ProposedAction,
  evaluate,
  ruleIds,
} from '../../src/policy/engine.js';
import { toCents } from '../../src/policy/money.js';
import type { Rulebook } from '../../src/policy/rulebook.js';

// What this file does NOT cover: the wording of any reason, which particular
// rule fired (engine.test.ts does that), and anything to do with the ledger.
// These runs prove the promises that must hold for every input, not the
// behaviour of one worked example.

const money = (maxUsd: number) => fc.integer({ min: 0, max: maxUsd * 100 }).map((c) => c / 100);

const isoDate = fc
  .integer({ min: Date.UTC(2026, 0, 1), max: Date.UTC(2026, 11, 31) })
  .map((ms) => new Date(ms).toISOString());

const rulebookArb: fc.Arbitrary<Rulebook> = fc.record({
  version: fc.constant(1 as const),
  name: fc.constant('fuzz book'),
  maxOrderUsd: money(500),
  maxDailyLossUsd: money(200),
  maxPositionUsdPerSymbol: money(1000),
  allowedSymbols: fc.subarray(['BNBUSDT', 'BTCUSDT', 'ETHUSDT']),
  allowShort: fc.boolean(),
  allowLeverage: fc.constant(false as const),
  maxDataSpendUsdPerDay: money(5),
  maxDataSpendUsdPerCall: money(1),
  cooldownSecondsBetweenOrders: fc.integer({ min: 0, max: 600 }),
  tradingHoursUtc: fc.option(
    fc
      .record({ start: fc.integer({ min: 0, max: 23 }), end: fc.integer({ min: 0, max: 23 }) })
      .filter((window) => window.start !== window.end),
    { nil: undefined },
  ),
  requireApprovalAboveUsd: money(500),
  oneSidePerMarket: fc.constant(true as const),
  drawdownTiers: fc.array(
    fc.record({ lossUsd: money(200), action: fc.constantFrom('halve' as const, 'halt' as const) }),
    { maxLength: 3 },
  ),
});

const stateArb: fc.Arbitrary<AccountState> = fc.record({
  nowIso: isoDate,
  killed: fc.boolean(),
  dailyLossUsd: money(300),
  dailyDataSpendUsd: money(5),
  openPositions: fc.array(
    fc.record({
      symbol: fc.constantFrom('BNBUSDT', 'BTCUSDT', 'ETHUSDT'),
      side: fc.constantFrom('LONG' as const, 'SHORT' as const),
      usd: money(500),
    }),
    { maxLength: 4 },
  ),
  lastOrderAtIso: fc.option(isoDate, { nil: undefined }),
});

const orderArb: fc.Arbitrary<ProposedAction> = fc.record({
  type: fc.constant('order' as const),
  symbol: fc.constantFrom('BNBUSDT', 'BTCUSDT', 'ETHUSDT', 'DOGEUSDT'),
  side: fc.constantFrom('BUY' as const, 'SELL' as const),
  quoteUsd: money(800),
  leverage: fc.option(fc.integer({ min: 1, max: 5 }), { nil: undefined }),
});

const paymentArb: fc.Arbitrary<ProposedAction> = fc.record({
  type: fc.constant('payment' as const),
  merchantUrl: fc.constantFrom('https://api.nansen.ai/x402', 'https://pro.coinmarketcap.com/x402'),
  amountUsd: money(2),
});

const actionArb = fc.oneof(orderArb, paymentArb);

describe('evaluate, properties that must hold for every input', () => {
  it('never allows an order bigger than the size it says is allowed right now', () => {
    fc.assert(
      fc.property(rulebookArb, orderArb, stateArb, (rulebook, action, state) => {
        const verdict = evaluate(rulebook, action, state);
        if (verdict.allowed && action.type === 'order') {
          expect(action.quoteUsd).toBeLessThanOrEqual(verdict.effectiveMaxOrderUsd);
        }
      }),
      { numRuns: 500 },
    );
  });

  it('refuses everything while the kill switch is on', () => {
    fc.assert(
      fc.property(rulebookArb, actionArb, stateArb, (rulebook, action, state) => {
        const verdict = evaluate(rulebook, action, { ...state, killed: true });
        expect(verdict.allowed).toBe(false);
        expect(verdict.ruleIds).toContain(ruleIds.killed);
      }),
      { numRuns: 500 },
    );
  });

  it('never lets a run of allowed payments pass the daily data budget', () => {
    fc.assert(
      fc.property(
        rulebookArb,
        stateArb,
        fc.array(money(2), { maxLength: 30 }),
        (rulebook, state, amounts) => {
          const budgetCents = toCents(rulebook.maxDataSpendUsdPerDay);
          let spentCents = 0;

          for (const amountUsd of amounts) {
            const verdict = evaluate(
              rulebook,
              { type: 'payment', merchantUrl: 'https://api.nansen.ai/x402', amountUsd },
              { ...state, killed: false, dailyDataSpendUsd: spentCents / 100 },
            );

            if (verdict.allowed) {
              spentCents += toCents(amountUsd);
            }

            expect(spentCents).toBeLessThanOrEqual(budgetCents);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it('gives the same verdict for the same inputs and changes nothing it was given', () => {
    fc.assert(
      fc.property(rulebookArb, actionArb, stateArb, (rulebook, action, state) => {
        const before = JSON.stringify([rulebook, action, state]);
        const first = evaluate(rulebook, action, state);
        const second = evaluate(rulebook, action, state);

        expect(second).toEqual(first);
        expect(JSON.stringify([rulebook, action, state])).toBe(before);
      }),
      { numRuns: 500 },
    );
  });

  it('answers with a refusal instead of throwing when the numbers are nonsense', () => {
    const hostile = fc.oneof(
      fc.constant(Number.NaN),
      fc.constant(Number.POSITIVE_INFINITY),
      fc.constant(Number.NEGATIVE_INFINITY),
      fc.double({ min: -1e12, max: 1e12, noNaN: true }),
    );

    fc.assert(
      fc.property(
        rulebookArb,
        stateArb,
        hostile,
        hostile,
        (rulebook, state, quoteUsd, dailyLossUsd) => {
          const verdict = evaluate(
            rulebook,
            { type: 'order', symbol: 'BNBUSDT', side: 'BUY', quoteUsd },
            { ...state, dailyLossUsd },
          );

          expect(typeof verdict.allowed).toBe('boolean');
          if (!Number.isFinite(quoteUsd) || quoteUsd <= 0) {
            expect(verdict.allowed).toBe(false);
          }
        },
      ),
      { numRuns: 500 },
    );
  });
});
