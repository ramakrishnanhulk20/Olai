import { describe, expect, it } from 'vitest';
import { rulebookSchema } from '../../src/policy/rulebook.js';
import { makeRulebook } from './fixtures.js';

// What this file does NOT cover: what the engine does with a valid rulebook
// (see engine.test.ts), and the exact wording of zod's own error messages.

const good = makeRulebook();

function reject(overrides: Record<string, unknown>): string {
  const result = rulebookSchema.safeParse({ ...good, ...overrides });
  expect(result.success).toBe(false);
  return result.success ? '' : JSON.stringify(result.error.issues);
}

describe('rulebookSchema', () => {
  it('accepts a complete rulebook unchanged', () => {
    expect(rulebookSchema.parse(good)).toEqual(good);
  });

  it('accepts a rulebook with no markets and no drawdown tiers', () => {
    expect(
      rulebookSchema.safeParse({ ...good, allowedSymbols: [], drawdownTiers: [] }).success,
    ).toBe(true);
  });

  it('refuses money that is not a real, non-negative, two-decimal amount', () => {
    reject({ maxOrderUsd: Number.NaN });
    reject({ maxOrderUsd: Number.POSITIVE_INFINITY });
    reject({ maxOrderUsd: -1 });
    reject({ maxOrderUsd: 10.005 });
    reject({ maxDailyLossUsd: Number.NEGATIVE_INFINITY });
    expect(rulebookSchema.safeParse({ ...good, maxOrderUsd: 0 }).success).toBe(true);
  });

  it('refuses leverage being switched on and one side per market being switched off', () => {
    reject({ allowLeverage: true });
    reject({ oneSidePerMarket: false });
  });

  it('refuses a trading window whose start and end are the same hour', () => {
    reject({ tradingHoursUtc: { start: 9, end: 9 } });
    reject({ tradingHoursUtc: { start: 9, end: 24 } });
    expect(rulebookSchema.safeParse({ ...good, tradingHoursUtc: { start: 22, end: 4 } }).success).toBe(
      true,
    );
  });

  it('refuses a per-call data cap above the whole day budget', () => {
    const issues = reject({ maxDataSpendUsdPerCall: 5, maxDataSpendUsdPerDay: 1 });
    expect(issues).toContain('day budget');
  });

  it('refuses a market name that is not an uppercase Binance symbol', () => {
    reject({ allowedSymbols: ['bnbusdt'] });
    reject({ allowedSymbols: ['BNB'] });
  });

  it('refuses a version it does not know and a nameless rulebook', () => {
    reject({ version: 2 });
    reject({ name: '   ' });
  });
});
