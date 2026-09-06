import type { AccountState } from '../../src/policy/engine.js';
import { type Rulebook, rulebookSchema } from '../../src/policy/rulebook.js';

/**
 * The rulebook every policy test starts from. It is parsed through the schema
 * so that a fixture which the schema would reject can never pass a test.
 */
export function makeRulebook(overrides: Partial<Rulebook> = {}): Rulebook {
  return rulebookSchema.parse({
    version: 1,
    name: 'Weekend desk',
    maxOrderUsd: 100,
    maxDailyLossUsd: 50,
    maxPositionUsdPerSymbol: 300,
    allowedSymbols: ['BNBUSDT', 'BTCUSDT'],
    allowShort: false,
    allowLeverage: false,
    maxDataSpendUsdPerDay: 1,
    maxDataSpendUsdPerCall: 0.25,
    cooldownSecondsBetweenOrders: 60,
    requireApprovalAboveUsd: 50,
    oneSidePerMarket: true,
    drawdownTiers: [],
    ...overrides,
  });
}

export function makeState(overrides: Partial<AccountState> = {}): AccountState {
  return {
    nowIso: '2026-09-06T12:00:00.000Z',
    killed: false,
    dailyLossUsd: 0,
    dailyDataSpendUsd: 0,
    openPositions: [],
    ...overrides,
  };
}
