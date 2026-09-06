import { describe, expect, it } from 'vitest';
import {
  type AccountState,
  type ProposedAction,
  evaluate,
  ruleIds,
} from '../../src/policy/engine.js';
import { makeRulebook, makeState } from './fixtures.js';

// What this file does NOT cover: the wording of the reasons beyond checking one
// example, the shape checks that live in rulebookSchema (see rulebook.test.ts),
// the random-input properties (see engine.property.test.ts), and anything about
// how a verdict is recorded in the ledger or shown in the app.

const buy = (quoteUsd: number, symbol = 'BNBUSDT'): ProposedAction => ({
  type: 'order',
  symbol,
  side: 'BUY',
  quoteUsd,
});

const sell = (quoteUsd: number, symbol = 'BNBUSDT'): ProposedAction => ({
  type: 'order',
  symbol,
  side: 'SELL',
  quoteUsd,
});

const pay = (amountUsd: number): ProposedAction => ({
  type: 'payment',
  merchantUrl: 'https://api.nansen.ai/x402/flows',
  amountUsd,
});

const long = (usd: number, symbol = 'BNBUSDT'): AccountState['openPositions'][number] => ({
  symbol,
  side: 'LONG',
  usd,
});

const short = (usd: number, symbol = 'BNBUSDT'): AccountState['openPositions'][number] => ({
  symbol,
  side: 'SHORT',
  usd,
});

describe('evaluate, the happy path', () => {
  it('allows an order that breaks no rule', () => {
    const verdict = evaluate(makeRulebook(), buy(25), makeState());

    expect(verdict).toEqual({
      allowed: true,
      requiresApproval: false,
      effectiveMaxOrderUsd: 100,
      reasons: [],
      ruleIds: [],
    });
  });

  it('allows a data payment inside both the per-call cap and the daily budget', () => {
    const verdict = evaluate(makeRulebook(), pay(0.01), makeState({ dailyDataSpendUsd: 0.5 }));

    expect(verdict.allowed).toBe(true);
    expect(verdict.ruleIds).toEqual([]);
  });
});

describe('evaluate, the stop rules', () => {
  it('refuses everything while the kill switch is on', () => {
    const killed = makeState({ killed: true });

    expect(evaluate(makeRulebook(), buy(1), killed)).toMatchObject({
      allowed: false,
      effectiveMaxOrderUsd: 0,
      ruleIds: [ruleIds.killed],
    });
    expect(evaluate(makeRulebook(), pay(0.01), killed).ruleIds).toEqual([ruleIds.killed]);
  });

  it('stops trading once the day is at the maximum loss', () => {
    const verdict = evaluate(makeRulebook(), buy(10), makeState({ dailyLossUsd: 50 }));

    expect(verdict.allowed).toBe(false);
    expect(verdict.ruleIds).toContain(ruleIds.dailyLoss);
    expect(verdict.effectiveMaxOrderUsd).toBe(0);
    expect(verdict.reasons[0]).toContain('$50.00');
  });

  it('leaves the data budget alone when trading is stopped for the day', () => {
    const verdict = evaluate(makeRulebook(), pay(0.01), makeState({ dailyLossUsd: 500 }));

    expect(verdict.allowed).toBe(true);
  });

  it('halves the biggest order for each halve tier the day has passed', () => {
    const rulebook = makeRulebook({
      drawdownTiers: [
        { lossUsd: 10, action: 'halve' },
        { lossUsd: 20, action: 'halve' },
      ],
    });

    expect(evaluate(rulebook, buy(50), makeState({ dailyLossUsd: 10 })).effectiveMaxOrderUsd).toBe(
      50,
    );
    expect(evaluate(rulebook, buy(30), makeState({ dailyLossUsd: 20 })).effectiveMaxOrderUsd).toBe(
      25,
    );

    const tooBig = evaluate(rulebook, buy(30), makeState({ dailyLossUsd: 20 }));
    expect(tooBig.allowed).toBe(false);
    expect(tooBig.ruleIds).toEqual([ruleIds.drawdownHalve, ruleIds.drawdownHalve, ruleIds.maxOrder]);
  });

  it('refuses when a halt tier has been reached', () => {
    const rulebook = makeRulebook({ drawdownTiers: [{ lossUsd: 20, action: 'halt' }] });
    const verdict = evaluate(rulebook, buy(1), makeState({ dailyLossUsd: 25 }));

    expect(verdict.allowed).toBe(false);
    expect(verdict.ruleIds).toContain(ruleIds.drawdownHalt);
    expect(verdict.effectiveMaxOrderUsd).toBe(0);
  });
});

describe('evaluate, the order rules', () => {
  it('refuses an order bigger than the rulebook allows', () => {
    const verdict = evaluate(makeRulebook(), buy(100.01), makeState());

    expect(verdict.allowed).toBe(false);
    expect(verdict.ruleIds).toContain(ruleIds.maxOrder);
    expect(evaluate(makeRulebook(), buy(100), makeState()).allowed).toBe(true);
  });

  it('refuses a market the rulebook does not list, including when it lists none', () => {
    expect(evaluate(makeRulebook(), buy(10, 'DOGEUSDT'), makeState()).ruleIds).toContain(
      ruleIds.symbolNotAllowed,
    );

    const noMarkets = makeRulebook({ allowedSymbols: [] });
    const verdict = evaluate(noMarkets, buy(10), makeState());
    expect(verdict.allowed).toBe(false);
    expect(verdict.reasons[0]).toContain('no markets at all');
  });

  it('refuses a sell with nothing long behind it while shorting is off', () => {
    const verdict = evaluate(makeRulebook(), sell(10), makeState());
    expect(verdict.ruleIds).toContain(ruleIds.shortNotAllowed);

    const withLong = evaluate(makeRulebook(), sell(10), makeState({ openPositions: [long(40)] }));
    expect(withLong.allowed).toBe(true);
  });

  it('refuses any leverage above 1', () => {
    const levered = evaluate(
      makeRulebook(),
      { type: 'order', symbol: 'BNBUSDT', side: 'BUY', quoteUsd: 10, leverage: 2 },
      makeState(),
    );
    expect(levered.ruleIds).toContain(ruleIds.leverageNotAllowed);

    const spot = evaluate(
      makeRulebook(),
      { type: 'order', symbol: 'BNBUSDT', side: 'BUY', quoteUsd: 10, leverage: 1 },
      makeState(),
    );
    expect(spot.allowed).toBe(true);
  });

  it('refuses an order that would push one market past its position cap', () => {
    const state = makeState({ openPositions: [long(250)] });
    expect(evaluate(makeRulebook(), buy(60), state).ruleIds).toContain(ruleIds.maxPosition);
    expect(evaluate(makeRulebook(), buy(50), state).allowed).toBe(true);
  });

  it('adds up more than one open row for the same market', () => {
    const state = makeState({ openPositions: [long(150), long(140)] });
    expect(evaluate(makeRulebook(), buy(20), state).ruleIds).toContain(ruleIds.maxPosition);
  });

  it('refuses while the cooldown is still running', () => {
    const rulebook = makeRulebook({ cooldownSecondsBetweenOrders: 60 });
    const tooSoon = evaluate(
      rulebook,
      buy(10),
      makeState({ lastOrderAtIso: '2026-09-06T11:59:30.000Z' }),
    );
    expect(tooSoon.allowed).toBe(false);
    expect(tooSoon.ruleIds).toContain(ruleIds.cooldown);

    const elapsed = evaluate(
      rulebook,
      buy(10),
      makeState({ lastOrderAtIso: '2026-09-06T11:59:00.000Z' }),
    );
    expect(elapsed.allowed).toBe(true);
  });

  it('refuses outside trading hours, including a window that runs past midnight', () => {
    const daytime = makeRulebook({ tradingHoursUtc: { start: 8, end: 16 } });
    expect(evaluate(daytime, buy(10), makeState()).allowed).toBe(true);
    expect(
      evaluate(daytime, buy(10), makeState({ nowIso: '2026-09-06T17:30:00.000Z' })).ruleIds,
    ).toContain(ruleIds.tradingHours);

    const overnight = makeRulebook({ tradingHoursUtc: { start: 22, end: 4 } });
    expect(evaluate(overnight, buy(10), makeState({ nowIso: '2026-09-06T23:10:00.000Z' })).allowed).toBe(
      true,
    );
    expect(evaluate(overnight, buy(10), makeState({ nowIso: '2026-09-06T03:10:00.000Z' })).allowed).toBe(
      true,
    );
    expect(evaluate(overnight, buy(10), makeState()).ruleIds).toContain(ruleIds.tradingHours);
  });

  it('keeps one side per market: no buying into an open short, no selling a long into a short', () => {
    const shorted = makeState({ openPositions: [short(40)] });
    expect(evaluate(makeRulebook({ allowShort: true }), buy(10), shorted).ruleIds).toContain(
      ruleIds.oneSidePerMarket,
    );

    const flip = evaluate(
      makeRulebook({ allowShort: true }),
      sell(60),
      makeState({ openPositions: [long(40)] }),
    );
    expect(flip.allowed).toBe(false);
    expect(flip.ruleIds).toContain(ruleIds.oneSidePerMarket);
    expect(flip.reasons.join(' ')).toContain('$40.00');
  });

  it('asks for the owner above the approval line, and still calls the order allowed', () => {
    const verdict = evaluate(makeRulebook(), buy(50.01), makeState());

    expect(verdict.allowed).toBe(true);
    expect(verdict.requiresApproval).toBe(true);
    expect(verdict.ruleIds).toEqual([ruleIds.needsApproval]);
    expect(evaluate(makeRulebook(), buy(50), makeState()).requiresApproval).toBe(false);
  });
});

describe('evaluate, the data payment rules', () => {
  it('refuses a single call above the per-call cap', () => {
    const verdict = evaluate(makeRulebook(), pay(0.26), makeState());

    expect(verdict.allowed).toBe(false);
    expect(verdict.ruleIds).toContain(ruleIds.paymentPerCall);
  });

  it('allows a listing that costs nothing and still refuses money that is not real', () => {
    expect(evaluate(makeRulebook(), pay(0), makeState()).allowed).toBe(true);

    for (const amount of [-0.01, Number.NaN, Number.POSITIVE_INFINITY]) {
      const verdict = evaluate(makeRulebook(), pay(amount), makeState());
      expect(verdict.allowed).toBe(false);
      expect(verdict.ruleIds).toContain(ruleIds.amountInvalid);
    }
  });

  it('refuses the call that would take the day past its data budget', () => {
    const nearlyDone = makeState({ dailyDataSpendUsd: 0.99 });

    expect(evaluate(makeRulebook(), pay(0.01), nearlyDone).allowed).toBe(true);
    expect(evaluate(makeRulebook(), pay(0.02), nearlyDone).ruleIds).toContain(
      ruleIds.paymentDailyBudget,
    );
  });
});

describe('evaluate, bad input', () => {
  it('refuses amounts that are not real money', () => {
    for (const amount of [Number.NaN, Number.POSITIVE_INFINITY, -5, 0]) {
      const verdict = evaluate(makeRulebook(), buy(amount), makeState());
      expect(verdict.allowed).toBe(false);
      expect(verdict.ruleIds).toContain(ruleIds.amountInvalid);
    }

    expect(evaluate(makeRulebook(), pay(Number.NaN), makeState()).ruleIds).toContain(
      ruleIds.amountInvalid,
    );
  });

  it('refuses an account snapshot it cannot read', () => {
    const verdict = evaluate(makeRulebook(), buy(10), makeState({ nowIso: 'yesterday' }));

    expect(verdict.allowed).toBe(false);
    expect(verdict.ruleIds).toEqual([ruleIds.stateInvalid]);
  });

  it('refuses when the rulebook itself holds a broken number', () => {
    const broken = { ...makeRulebook(), maxOrderUsd: Number.NaN };
    const verdict = evaluate(broken, buy(10), makeState());

    expect(verdict.allowed).toBe(false);
    expect(verdict.ruleIds).toEqual([ruleIds.rulebookInvalid]);
  });
});
