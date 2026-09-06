import { afterEach, describe, expect, it } from 'vitest';
import type { Proposal } from '../../src/brain/proposal.js';
import { Ledger } from '../../src/ledger/ledger.js';
import type { AccountState } from '../../src/policy/engine.js';
import type { Rulebook } from '../../src/policy/rulebook.js';
import { FakeData, FakeExchange } from '../../src/ports/fake.js';
import { SessionRunner } from '../../src/session/session.js';
import { fakeAnthropic } from '../brain/fake-anthropic.js';
import { makeRulebook, makeState } from '../policy/fixtures.js';

/**
 * What this file does NOT cover: the real Anthropic API, the real Binance
 * exchange (orders land on FakeExchange), the real wallet, and what happens
 * across a restart, since session records live in memory by design and only the
 * ledger survives. The brain's own tools are covered in test/brain/analyst.test.ts.
 */

const openLedgers: Ledger[] = [];

afterEach(() => {
  while (openLedgers.length > 0) {
    openLedgers.pop()?.close();
  }
});

const buyBnb: Proposal = {
  summary: 'Add 50 dollars of BNB.',
  reasoning: 'Flows turned positive and the book is deep enough for this size.',
  action: { type: 'order', symbol: 'BNBUSDT', side: 'BUY', quoteUsd: 50, orderType: 'MARKET' },
  confidence: 0.7,
  dataUsed: [],
  risks: ['A weekend gap would hurt this.'],
};

const holdBnb: Proposal = {
  summary: 'Do nothing today.',
  reasoning: 'Nothing in the free reads argues for a trade.',
  action: { type: 'hold', reason: 'Evidence is thin.' },
  confidence: 0.35,
  dataUsed: [],
  risks: [],
};

function setup(
  proposal: Proposal,
  options: { dryRun?: boolean; rulebook?: Rulebook; state?: AccountState } = {},
) {
  const ledger = new Ledger(':memory:');
  openLedgers.push(ledger);
  const exchange = new FakeExchange();
  const state = options.state ?? makeState();

  const runner = new SessionRunner({
    exchange,
    data: new FakeData(),
    ledger,
    rulebook: options.rulebook ?? makeRulebook(),
    anthropic: fakeAnthropic([[{ toolCalls: [{ name: 'propose', input: proposal }] }]]).client,
    dryRun: options.dryRun ?? false,
    accountState: async () => state,
  });

  return { ledger, exchange, runner, kinds: () => ledger.list().map((entry) => entry.kind) };
}

describe('SessionRunner', () => {
  it('runs a dry-run session from question to executed without touching the exchange', async () => {
    const { runner, exchange, kinds } = setup(buyBnb, { dryRun: true });

    const asked = await runner.ask('Should I add BNB?');
    expect(asked.status).toBe('pending');
    expect(asked.verdict?.allowed).toBe(true);

    const approved = await runner.approve(asked.id);
    expect(approved.status).toBe('executed');
    expect(approved.orderResult).toBeUndefined();
    expect(exchange.orders).toEqual([]);

    expect(kinds()).toEqual(['question', 'proposal', 'proposal', 'approval', 'order.sent']);
    const sent = runner.get(asked.id);
    expect(sent?.status).toBe('executed');
  });

  it('places exactly one live order and ignores a second approval of the same session', async () => {
    const { runner, exchange, kinds } = setup(buyBnb);

    const asked = await runner.ask('Should I add BNB?');
    const first = await runner.approve(asked.id);

    expect(first.status).toBe('executed');
    expect(first.orderResult?.status).toBe('FILLED');
    expect(exchange.orders).toHaveLength(1);
    expect(exchange.orders[0]?.clientOrderId).toBe(asked.id);
    expect(exchange.orders[0]?.quoteUsd).toBe(50);

    const second = await runner.approve(asked.id);
    expect(second.status).toBe('executed');
    expect(exchange.orders).toHaveLength(1);

    expect(kinds()).toEqual([
      'question',
      'proposal',
      'proposal',
      'approval',
      'order.sent',
      'order.filled',
    ]);
  });

  it('refuses a proposal the rulebook forbids before the owner is asked', async () => {
    const tooBig: Proposal = {
      ...buyBnb,
      action: { type: 'order', symbol: 'BNBUSDT', side: 'BUY', quoteUsd: 500, orderType: 'MARKET' },
    };
    const { runner, exchange, kinds, ledger } = setup(tooBig);

    const asked = await runner.ask('Should I buy 500 dollars of BNB?');

    expect(asked.status).toBe('refused');
    expect(asked.verdict?.allowed).toBe(false);
    expect(exchange.orders).toEqual([]);
    expect(kinds()).toEqual(['question', 'proposal', 'rule.refused']);
    expect(ledger.list({ kinds: ['rule.refused'] })[0]?.payload.ruleIds).toContain(
      'order.max_size',
    );

    await expect(runner.approve(asked.id)).rejects.toThrowError(/refused/);
  });

  it('refuses an approval after the kill switch, and nothing reaches the exchange', async () => {
    const { runner, exchange, kinds } = setup(buyBnb);

    const asked = await runner.ask('Should I add BNB?');
    runner.kill();

    const stopped = await runner.approve(asked.id);

    expect(stopped.status).toBe('pending');
    expect(stopped.verdict?.ruleIds).toContain('agent.killed');
    expect(exchange.orders).toEqual([]);
    expect(kinds()).toEqual(['question', 'proposal', 'proposal', 'kill', 'rule.refused']);

    runner.resume();
    expect(runner.isKilled).toBe(false);
    expect(kinds().at(-1)).toBe('resume');

    const after = await runner.approve(asked.id);
    expect(after.status).toBe('executed');
    expect(exchange.orders).toHaveLength(1);
  });

  it('places one order when two approvals of the same session arrive together', async () => {
    const { runner, exchange } = setup(buyBnb);

    const asked = await runner.ask('Should I add BNB?');
    const [first, second] = await Promise.all([runner.approve(asked.id), runner.approve(asked.id)]);

    expect(first.status).toBe('executed');
    expect(second.status).toBe('executed');
    expect(exchange.orders).toHaveLength(1);
  });

  it('checks the second of two sessions approved together against the first one\'s order', async () => {
    const ledger = new Ledger(':memory:');
    openLedgers.push(ledger);
    const exchange = new FakeExchange();

    // The account is read as it stands and answered a tick later, the way a
    // real venue does. That gap is the window two approvals used to overlap in.
    const accountState = async () => {
      const held = exchange.orders.reduce((total, order) => total + order.quoteUsd, 0);
      await new Promise((resolve) => setTimeout(resolve, 0));
      return makeState({
        openPositions: held > 0 ? [{ symbol: 'BNBUSDT', side: 'LONG' as const, usd: held }] : [],
      });
    };

    const runner = new SessionRunner({
      exchange,
      data: new FakeData(),
      ledger,
      rulebook: makeRulebook({ maxPositionUsdPerSymbol: 50 }),
      anthropic: fakeAnthropic([
        [{ toolCalls: [{ name: 'propose', input: buyBnb }] }],
        [{ toolCalls: [{ name: 'propose', input: buyBnb }] }],
      ]).client,
      dryRun: false,
      accountState,
    });

    const first = await runner.ask('Should I add BNB?');
    const second = await runner.ask('Should I add more BNB?');

    const [one, two] = await Promise.all([runner.approve(first.id), runner.approve(second.id)]);

    expect(exchange.orders).toHaveLength(1);
    expect([one.status, two.status].sort()).toEqual(['executed', 'pending']);

    const refused = ledger.list({ kinds: ['rule.refused'] });
    expect(refused).toHaveLength(1);
    expect(refused[0]?.payload.ruleIds).toContain('order.max_position');
  });

  it('approves a hold straight away and leaves nothing to execute', async () => {
    const { runner, exchange, kinds } = setup(holdBnb);

    const asked = await runner.ask('Anything worth doing today?');

    expect(asked.status).toBe('approved');
    expect(asked.verdict).toBeUndefined();
    expect(exchange.orders).toEqual([]);
    expect(kinds()).toEqual(['question', 'proposal', 'proposal']);
  });

  it('records a rejection and sends nothing', async () => {
    const { runner, exchange, kinds } = setup(buyBnb);

    const asked = await runner.ask('Should I add BNB?');
    const rejected = await runner.reject(asked.id, 'I want to wait for the close.');

    expect(rejected.status).toBe('rejected');
    expect(exchange.orders).toEqual([]);
    expect(kinds().at(-1)).toBe('rejection');
    await expect(runner.approve(asked.id)).rejects.toThrowError(/rejected/);
  });
});
