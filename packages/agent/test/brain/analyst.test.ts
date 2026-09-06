import { afterEach, describe, expect, it } from 'vitest';
import { NoProposalError, runAnalyst } from '../../src/brain/analyst.js';
import type { Proposal } from '../../src/brain/proposal.js';
import { Ledger } from '../../src/ledger/ledger.js';
import type { AccountState } from '../../src/policy/engine.js';
import type { Rulebook } from '../../src/policy/rulebook.js';
import { FakeData, FakeExchange, fakeResource } from '../../src/ports/fake.js';
import type { X402Option } from '../../src/x402/baw.js';
import { makeRulebook, makeState } from '../policy/fixtures.js';
import { type ScriptedTurn, fakeAnthropic } from './fake-anthropic.js';

/**
 * What this file does NOT cover: the real Anthropic API (the client is scripted,
 * so nothing here proves the request body is one the API accepts), the real
 * Bazaar and the real wallet, and prompt caching, which only shows up in usage
 * numbers from a live call. The session runner and the order path are covered
 * in test/session/session.test.ts.
 */

const NANSEN = 'https://api.nansen.ai/api/v1/profiler/address/current-balance';
const CMC = 'https://pro-api.coinmarketcap.com/x402/v3/cryptocurrency/quotes/latest?symbol=BNB';

/** The body the Nansen hint sends when the model names no address of its own. */
const NANSEN_BODY = {
  address: '0x28c6c06298d514db089934071355e5743bf21d60',
  chain: 'ethereum',
  hide_spam_token: true,
  pagination: { page: 1, per_page: 10 },
};

const PAID_OPTION: X402Option = {
  index: 1,
  status: 'READY_TO_SIGN',
  reasons: [],
  scheme: 'eip3009',
};

/** Every tool result the analyst handed back to the model, in order. */
function toolResults(transcript: unknown[]): string[] {
  const out: string[] = [];

  for (const message of transcript as Array<{ content?: unknown }>) {
    if (!Array.isArray(message.content)) {
      continue;
    }
    for (const block of message.content as Array<Record<string, unknown>>) {
      if (block['type'] === 'tool_result' && typeof block['content'] === 'string') {
        out.push(block['content']);
      }
    }
  }

  return out;
}

const openLedgers: Ledger[] = [];

function newLedger(): Ledger {
  const ledger = new Ledger(':memory:');
  openLedgers.push(ledger);
  return ledger;
}

afterEach(() => {
  while (openLedgers.length > 0) {
    openLedgers.pop()?.close();
  }
});

const holdProposal: Proposal = {
  summary: 'Hold BNB for now.',
  reasoning: 'Flows are flat and the book is thin.',
  action: { type: 'hold', reason: 'Not enough evidence to move.' },
  confidence: 0.4,
  dataUsed: [],
  risks: ['One wallet feed is a narrow view.'],
};

function paidProposal(costUsd: number, txHash: string): Proposal {
  return {
    ...holdProposal,
    dataUsed: [{ url: NANSEN, costUsd, txHash }],
  };
}

function setup(
  runs: ScriptedTurn[][],
  options: {
    rulebook?: Rulebook;
    state?: AccountState;
    data?: FakeData;
    dryRun?: boolean;
  } = {},
) {
  const ledger = newLedger();
  const exchange = new FakeExchange();
  const data = options.data ?? new FakeData();
  const anthropic = fakeAnthropic(runs);
  const state = options.state ?? makeState();
  const events: string[] = [];

  return {
    ledger,
    exchange,
    data,
    anthropic,
    events,
    kinds: () => ledger.list().map((entry) => entry.kind),
    run: (question: string) =>
      runAnalyst(question, {
        anthropic: anthropic.client,
        exchange,
        data,
        ledger,
        rulebook: options.rulebook ?? makeRulebook(),
        accountState: async () => state,
        sessionId: 'ol-test',
        dryRun: options.dryRun ?? false,
        onEvent: (event) => {
          events.push(event.type === 'tool' ? `tool:${event.name}` : event.type);
        },
      }),
  };
}

describe('runAnalyst', () => {
  it('reads the market, buys one Bazaar resource and records both in the ledger', async () => {
    const data = new FakeData({
      resources: [
        fakeResource({ url: NANSEN, description: 'BNB wallet flows by address', priceUsd: 0.01 }),
      ],
      outcomes: {
        [NANSEN]: {
          status: 'paid',
          data: { netInflowUsd: 412_000 },
          costUsd: 0.01,
          txHash: '0xabc123',
          paymentId: 'pay-1',
          option: { index: 1, status: 'READY_TO_SIGN', reasons: [], scheme: 'eip3009' },
          settlement: { txHash: '0xabc123' },
        },
      },
    });

    const harness = setup(
      [
        [
          { thinking: 'Check the price first.', toolCalls: [{ name: 'read_ticker', input: { symbol: 'BNBUSDT' } }] },
          {
            toolCalls: [{ name: 'search_bazaar', input: { query: 'BNB wallet flows', maxUsdPrice: 0.05 } }],
          },
          { toolCalls: [{ name: 'buy_data', input: { url: NANSEN, method: 'POST', body: { chain: 'bnb' } } }] },
          { text: 'Here is what I found.', toolCalls: [{ name: 'propose', input: paidProposal(0.01, '0xabc123') }] },
        ],
      ],
      { data },
    );

    const { proposal, transcript } = await harness.run('Should I trim BNB before the weekend?');

    expect(proposal.action.type).toBe('hold');
    expect(proposal.dataUsed).toEqual([{ url: NANSEN, costUsd: 0.01, txHash: '0xabc123' }]);
    expect(data.buys).toHaveLength(1);
    // The buyer's ceiling is the rulebook's per-call cap, not the listed price,
    // so a live quote a fraction above the listing is still paid.
    expect(data.buys[0]?.maxUsdPerCall).toBe(0.25);
    expect(transcript.length).toBeGreaterThan(1);
    expect(harness.events).toContain('thinking');
    expect(harness.events).toContain('tool:buy_data');
    expect(harness.events.at(-1)).toBe('proposal');

    expect(harness.kinds()).toEqual([
      'question',
      'note',
      'discovery',
      'payment.preview',
      'proposal',
    ]);

    // The settlement line belongs to the data port, which is faked here. Its
    // own test in test/ports/data.test.ts is what proves the line gets written.
    expect(harness.ledger.list({ kinds: ['payment.settled'] })).toHaveLength(0);
  });

  it('refuses a purchase the rulebook will not pay for and never calls the merchant', async () => {
    const data = new FakeData({
      outcomes: {
        [NANSEN]: {
          status: 'paid',
          data: {},
          costUsd: 0.25,
          txHash: '0xdead',
          paymentId: 'pay-2',
          option: { index: 1, status: 'READY_TO_SIGN', reasons: [], scheme: 'eip3009' },
          settlement: {},
        },
      },
    });

    const harness = setup(
      [
        [
          { toolCalls: [{ name: 'buy_data', input: { url: NANSEN } }] },
          { toolCalls: [{ name: 'propose', input: holdProposal }] },
        ],
      ],
      {
        data,
        // The whole day's data budget is already gone, so the next cent is refused.
        state: makeState({ dailyDataSpendUsd: 1 }),
      },
    );

    const { proposal } = await harness.run('Any news on BNB?');

    expect(proposal.dataUsed).toEqual([]);
    expect(data.buys).toEqual([]);
    expect(harness.kinds()).toEqual(['question', 'rule.refused', 'proposal']);

    const refusal = harness.ledger.list({ kinds: ['rule.refused'] })[0];
    expect(refusal?.payload.ruleIds).toContain('payment.daily_budget');
  });

  it('asks once more when the model does not propose, then gives up', async () => {
    const harness = setup([
      [{ text: 'Interesting question.' }],
      [{ text: 'Still thinking about it.' }],
    ]);

    await expect(harness.run('What should I do?')).rejects.toBeInstanceOf(NoProposalError);

    expect(harness.anthropic.calls).toHaveLength(2);
    const secondRun = harness.anthropic.calls[1];
    const nudge = secondRun?.messages.at(-1);
    expect(JSON.stringify(nudge)).toContain('You must end by calling propose');
    expect(harness.kinds()).toEqual(['question']);
  });

  it('puts a proven merchant at the top of the search and shows how to call it', async () => {
    // Does NOT cover the real Bazaar's own ordering. The fake returns fixtures in
    // the order they were written, so the reordering here is Olai's, not theirs.
    const unproven = 'https://api.example.com/v1/bnb-flows';
    const data = new FakeData({
      resources: [
        fakeResource({ url: unproven, description: 'BNB flows, never paid before', priceUsd: 0.01 }),
        fakeResource({ url: NANSEN, description: 'BNB balances by address', priceUsd: 0.01 }),
      ],
    });

    const harness = setup(
      [
        [
          { toolCalls: [{ name: 'search_bazaar', input: { query: 'BNB', maxUsdPrice: 0.05 } }] },
          { toolCalls: [{ name: 'propose', input: holdProposal }] },
        ],
      ],
      { data },
    );

    const { transcript } = await harness.run('Where is BNB moving?');
    const rows = JSON.parse(toolResults(transcript)[0] ?? '[]') as Array<Record<string, unknown>>;

    expect(rows.map((row) => row['url'])).toEqual([NANSEN, unproven]);
    expect(rows[0]?.['request']).toEqual({
      method: 'POST',
      describe: "POST a JSON body {address, chain}; returns the wallet's current token balances",
      url: NANSEN,
      body: NANSEN_BODY,
    });
    expect(rows[1]?.['request']).toBeUndefined();
  });

  it('sends the proven request when the model names a merchant and no body', async () => {
    // Does NOT cover the merchant accepting the body. It proves what Olai sends,
    // which is the part that came back HTTP 400 in the live session.
    const data = new FakeData({
      outcomes: {
        [NANSEN]: {
          status: 'paid',
          data: { balances: [] },
          costUsd: 0.01,
          txHash: '0xbeef',
          paymentId: 'pay-3',
          option: PAID_OPTION,
          settlement: {},
        },
      },
    });

    const harness = setup(
      [
        [
          { toolCalls: [{ name: 'buy_data', input: { url: NANSEN } }] },
          { toolCalls: [{ name: 'propose', input: paidProposal(0.01, '0xbeef') }] },
        ],
      ],
      { data },
    );

    await harness.run('What is the biggest BNB wallet holding?');

    expect(data.buys[0]?.req).toEqual({
      url: NANSEN,
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: NANSEN_BODY,
    });

    const hintNote = harness.ledger
      .list({ kinds: ['note'] })
      .find((entry) => entry.payload.usedHint === true);
    expect(String(hintNote?.payload.summary)).toContain('Used the proven request');
  });

  it('tries one more merchant when the first one fails, and pays the second', async () => {
    // Does NOT cover a merchant that fails after the money is signed away. That
    // path lives in the buyer and is covered in test/x402/buyer.test.ts.
    const dead = 'https://api.dead.example/v1/flows';
    const data = new FakeData({
      outcomes: {
        [dead]: { status: 'failed', reason: 'merchant returned HTTP 400' },
        [CMC]: {
          status: 'paid',
          data: { price: 612.4 },
          costUsd: 0.01,
          txHash: '0xcafe',
          paymentId: 'pay-4',
          option: PAID_OPTION,
          settlement: {},
        },
      },
    });

    const harness = setup(
      [
        [
          { toolCalls: [{ name: 'buy_data', input: { url: dead } }] },
          { toolCalls: [{ name: 'buy_data', input: { url: CMC } }] },
          {
            toolCalls: [
              {
                name: 'propose',
                input: {
                  ...holdProposal,
                  dataUsed: [{ url: CMC, costUsd: 0.01, txHash: '0xcafe' }],
                },
              },
            ],
          },
        ],
      ],
      { data },
    );

    const { proposal, transcript } = await harness.run('What is BNB worth right now?');

    expect(proposal.dataUsed).toEqual([{ url: CMC, costUsd: 0.01, txHash: '0xcafe' }]);
    expect(data.buys.map((entry) => entry.req)).toEqual([
      { url: dead, method: 'GET' },
      { url: CMC, method: 'GET' },
    ]);
    expect(toolResults(transcript)[0]).toBe(
      'this merchant failed: merchant returned HTTP 400. Try the next listing from search_bazaar once, then continue without paid data',
    );

    const failedNotes = harness.ledger
      .list({ kinds: ['note'] })
      .filter((entry) => entry.payload.failed === true);
    expect(failedNotes).toHaveLength(1);
    expect(failedNotes[0]?.payload.url).toBe(dead);

    // Two previews, one per attempt: the line says money is about to move, and the
    // dead merchant was quoted before it answered with an error.
    expect(
      harness.ledger.list({ kinds: ['payment.preview'] }).map((entry) => entry.payload.url),
    ).toEqual([dead, CMC]);
    expect(harness.ledger.list({ kinds: ['payment.settled'] })).toHaveLength(0);
  });

  it('will not chase a third merchant after two have failed', async () => {
    // Does NOT cover a session where the same failing URL is asked for twice. The
    // rule counts distinct merchants, not attempts.
    const first = 'https://api.dead-one.example/v1/flows';
    const second = 'https://api.dead-two.example/v1/flows';
    const third = 'https://api.dead-three.example/v1/flows';
    const data = new FakeData({
      outcomes: {
        [first]: { status: 'failed', reason: 'merchant returned HTTP 400' },
        [second]: { status: 'failed', reason: 'merchant returned HTTP 503' },
        [third]: {
          status: 'paid',
          data: { flows: [] },
          costUsd: 0.01,
          txHash: '0xfeed',
          paymentId: 'pay-5',
          option: PAID_OPTION,
          settlement: {},
        },
      },
    });

    const harness = setup(
      [
        [
          { toolCalls: [{ name: 'buy_data', input: { url: first } }] },
          { toolCalls: [{ name: 'buy_data', input: { url: second } }] },
          { toolCalls: [{ name: 'buy_data', input: { url: third } }] },
          { toolCalls: [{ name: 'propose', input: holdProposal }] },
        ],
      ],
      { data },
    );

    const { proposal, transcript } = await harness.run('Any flows worth knowing about?');
    const results = toolResults(transcript);

    expect(results[1]).toBe(
      'this merchant failed: merchant returned HTTP 503. paid data is not available this session, proceed on free reads',
    );
    expect(results[2]).toBe('paid data is not available this session, proceed on free reads');
    expect(data.buys.map((entry) => entry.req.url)).toEqual([first, second]);
    expect(proposal.dataUsed).toEqual([]);
  });
});
