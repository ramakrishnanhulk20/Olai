import { afterEach, describe, expect, it } from 'vitest';
import { AccountStateError, AccountStateSource } from '../../src/account/state.js';
import { Ledger } from '../../src/ledger/ledger.js';
import type { Balance } from '../../src/ports/exchange.js';
import { FakeExchange } from '../../src/ports/fake.js';

/**
 * What this file does NOT cover: real Binance balances and how they are priced,
 * unrealised profit and loss on an open position (the day's loss here is
 * measured on account value, not on entry prices), and the kill switch, which
 * the session runner owns and lays over the top of every snapshot.
 */

const NOW = new Date('2026-09-06T12:00:00.000Z');
const openLedgers: Ledger[] = [];

afterEach(() => {
  while (openLedgers.length > 0) {
    openLedgers.pop()?.close();
  }
});

function newLedger(): Ledger {
  const ledger = new Ledger(':memory:');
  openLedgers.push(ledger);
  return ledger;
}

function source(balances: Balance[], ledger: Ledger, now: Date = NOW): AccountStateSource {
  return new AccountStateSource({
    exchange: new FakeExchange({ balances }),
    ledger,
    now: () => now,
  });
}

const cash: Balance = { asset: 'USDT', free: 500, locked: 0, usdValue: 500 };

describe('AccountStateSource', () => {
  it('reads holdings as long positions and leaves out cash and dust', async () => {
    const state = await source(
      [
        cash,
        { asset: 'BNB', free: 0.05, locked: 0, usdValue: 30.62 },
        { asset: 'DOGE', free: 4, locked: 0, usdValue: 0.6 },
        { asset: 'XRP', free: 10, locked: 0, usdValue: null },
      ],
      newLedger(),
    ).snapshot();

    expect(state.nowIso).toBe('2026-09-06T12:00:00.000Z');
    expect(state.killed).toBe(false);
    expect(state.openPositions).toEqual([{ symbol: 'BNBUSDT', side: 'LONG', usd: 30.62 }]);
    expect(state.lastOrderAtIso).toBeUndefined();
    expect(state.dailyLossUsd).toBe(0);
  });

  it('writes the opening equity once a day and measures the loss against it', async () => {
    const ledger = newLedger();

    await source([cash], ledger).snapshot();
    await source([cash], ledger).snapshot();

    const notes = ledger.list({ kinds: ['note'] });
    expect(notes).toHaveLength(1);
    expect(notes[0]?.payload).toMatchObject({
      kind: 'equity.day_start',
      date: '2026-09-06',
      equityUsd: 500,
    });

    const later = await source(
      [{ asset: 'USDT', free: 487.5, locked: 0, usdValue: 487.5 }],
      ledger,
    ).snapshot();

    expect(later.dailyLossUsd).toBe(12.5);
    expect(ledger.list({ kinds: ['note'] })).toHaveLength(1);
  });

  it('counts unpriced cash at face value and never reports a negative loss', async () => {
    const ledger = newLedger();
    await source([{ asset: 'USDT', free: 100, locked: 20, usdValue: null }], ledger).snapshot();

    const richer = await source(
      [{ asset: 'USDT', free: 200, locked: 0, usdValue: 200 }],
      ledger,
    ).snapshot();

    expect(richer.dailyLossUsd).toBe(0);
  });

  it('counts a signed payment once and not again when it settles', async () => {
    const ledger = newLedger();
    ledger.append({
      kind: 'payment.signed',
      actor: 'agent',
      costUsd: 0.03,
      payload: { summary: 'About to pay for a funding read', paymentId: 'pay-1' },
    });
    // The settled twin of the line above, carrying the same cost a second time.
    ledger.append({
      kind: 'payment.settled',
      actor: 'merchant',
      costUsd: 0.03,
      payload: { summary: 'Paid for a funding read', paymentId: 'pay-1' },
    });
    ledger.append({
      kind: 'payment.signed',
      actor: 'agent',
      costUsd: 0.02,
      payload: { summary: 'About to pay for a flow read', paymentId: 'pay-2' },
    });
    ledger.append({ kind: 'order.sent', actor: 'agent', payload: { summary: 'First order' } });
    const last = ledger.append({
      kind: 'order.sent',
      actor: 'agent',
      payload: { summary: 'Second order' },
    });

    // The ledger stamps its own lines with the real clock, so the snapshot is
    // read from the moment the last line landed. Otherwise a fixed test time on
    // the other side of midnight UTC would call today's spending yesterday's.
    const state = await source([cash], ledger, new Date(last.ts)).snapshot();

    expect(state.dailyDataSpendUsd).toBe(0.05);
    expect(state.lastOrderAtIso).toBe(last.ts);
  });

  it('treats a holding worth exactly one dollar as a position', async () => {
    const state = await source(
      [
        cash,
        { asset: 'ETH', free: 0.0004, locked: 0, usdValue: 1 },
        { asset: 'DOGE', free: 4, locked: 0, usdValue: 0.99 },
      ],
      newLedger(),
    ).snapshot();

    expect(state.openPositions).toEqual([{ symbol: 'ETHUSDT', side: 'LONG', usd: 1 }]);
  });

  it('says in the ledger which holdings the venue would not price', async () => {
    const ledger = newLedger();

    const state = await source(
      [cash, { asset: 'XRP', free: 10, locked: 0, usdValue: null }],
      ledger,
    ).snapshot();

    expect(state.openPositions).toEqual([]);

    const unpriced = ledger
      .list({ kinds: ['note'] })
      .filter((entry) => entry.payload.kind === 'positions.unpriced');
    expect(unpriced).toHaveLength(1);
    expect(unpriced[0]?.payload.assets).toEqual(['XRP']);
  });

  it('refuses to guess when the exchange will not answer', async () => {
    class SilentExchange extends FakeExchange {
      override async balances(): Promise<Balance[]> {
        throw new Error('binance said no');
      }
    }

    const state = new AccountStateSource({
      exchange: new SilentExchange(),
      ledger: newLedger(),
      now: () => NOW,
    });

    await expect(state.snapshot()).rejects.toBeInstanceOf(AccountStateError);
  });
});
