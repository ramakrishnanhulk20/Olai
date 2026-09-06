import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AccountStateSource } from '../../src/account/state.js';
import type { BazaarClient } from '../../src/bazaar/client.js';
import { createApp } from '../../src/api/app.js';
import { EventHub } from '../../src/api/events.js';
import type { Proposal } from '../../src/brain/proposal.js';
import { Ledger } from '../../src/ledger/ledger.js';
import type { Balance } from '../../src/ports/exchange.js';
import { FakeData, FakeExchange } from '../../src/ports/fake.js';
import { RulebookStore, defaultRulebook } from '../../src/rulebook/store.js';
import { SessionRunner } from '../../src/session/session.js';
import { fakeAnthropic } from '../brain/fake-anthropic.js';

/**
 * What this file does NOT cover: the real Anthropic API, a real Binance
 * connection (orders stop at FakeExchange and every session here is a dry run),
 * the wallet and Bazaar routes against live services, TLS, and whether the rate
 * limit holds up behind a proxy, since nothing here sets a real client address.
 * The event stream has its own file.
 */

const TOKEN = `ol.${'k'.repeat(40)}`;
const OWNER = { authorization: `Bearer ${TOKEN}` };
const NOW = new Date('2026-09-06T12:00:00.000Z');

const buyBnb: Proposal = {
  summary: 'Add 20 dollars of BNB.',
  reasoning: 'The book is deep enough for this size and the trend is intact.',
  action: { type: 'order', symbol: 'BNBUSDT', side: 'BUY', quoteUsd: 20, orderType: 'MARKET' },
  confidence: 0.6,
  dataUsed: [],
  risks: ['A weekend gap would hurt this.'],
};

const openLedgers: Ledger[] = [];
const tempDirs: string[] = [];

afterEach(() => {
  while (openLedgers.length > 0) {
    openLedgers.pop()?.close();
  }
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop() as string, { recursive: true, force: true });
  }
});

function setup(options: { proposal?: Proposal; balances?: Balance[]; bazaar?: BazaarClient } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'olai-api-'));
  tempDirs.push(dir);

  const ledger = new Ledger(':memory:');
  openLedgers.push(ledger);

  const exchange = new FakeExchange({
    balances: options.balances ?? [{ asset: 'USDT', free: 500, locked: 0, usdValue: 500 }],
  });
  const account = new AccountStateSource({ exchange, ledger, now: () => NOW });
  const events = new EventHub();
  const rulebooks = new RulebookStore({ path: join(dir, 'rulebook.json'), ledger });

  const runner = new SessionRunner({
    exchange,
    data: new FakeData(),
    ledger,
    rulebook: defaultRulebook,
    anthropic: fakeAnthropic([
      [{ toolCalls: [{ name: 'propose', input: options.proposal ?? buyBnb }] }],
    ]).client,
    dryRun: true,
    accountState: () => account.snapshot(),
  });

  const app = createApp({
    runner,
    ledger,
    rulebooks,
    account,
    ownerToken: TOKEN,
    dryRun: true,
    events,
    ...(options.bazaar ? { bazaar: options.bazaar } : {}),
  });

  return { app, ledger, events, exchange, runner, rulebooks };
}

async function ask(app: ReturnType<typeof setup>['app'], question: string) {
  const response = await app.request('/api/ask', {
    method: 'POST',
    headers: { ...OWNER, 'content-type': 'application/json' },
    body: JSON.stringify({ question }),
  });
  expect(response.status).toBe(200);
  return (await response.json()) as { id: string; status: string };
}

describe('owner API', () => {
  it('answers health without a token and refuses the API without one', async () => {
    const { app } = setup();

    const health = await app.request('/health');
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ ok: true, dryRun: true, killed: false });

    const refused = await app.request('/api/rulebook');
    expect(refused.status).toBe(401);
  });

  it('refuses a token that is wrong in one character', async () => {
    const { app } = setup();
    const nearly = `${TOKEN.slice(0, -1)}z`;

    const response = await app.request('/api/rulebook', {
      headers: { authorization: `Bearer ${nearly}` },
    });

    expect(response.status).toBe(401);
  });

  it('rate limits a caller after sixty requests in a minute', async () => {
    const { app } = setup();

    for (let i = 0; i < 60; i += 1) {
      const allowed = await app.request('/api/rulebook', { headers: OWNER });
      expect(allowed.status).toBe(200);
    }

    const blocked = await app.request('/api/rulebook', { headers: OWNER });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).toBeTruthy();

    // A caller cannot buy themselves a fresh allowance by claiming a new address.
    const spoofed = await app.request('/api/rulebook', {
      headers: { ...OWNER, 'x-forwarded-for': '203.0.113.9' },
    });
    expect(spoofed.status).toBe(429);
  });

  it('takes a rulebook, hands the same one back, and records it', async () => {
    const { app, ledger } = setup();
    const wanted = { ...defaultRulebook, name: 'Careful weekend', maxOrderUsd: 15 };

    const saved = await app.request('/api/rulebook', {
      method: 'PUT',
      headers: { ...OWNER, 'content-type': 'application/json' },
      body: JSON.stringify(wanted),
    });

    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual(wanted);

    const read = await app.request('/api/rulebook', { headers: OWNER });
    expect(await read.json()).toEqual(wanted);
    expect(ledger.list({ kinds: ['rulebook.set'] })).toHaveLength(1);
  });

  it('turns down a rulebook the schema rejects and says which field was wrong', async () => {
    const { app, ledger } = setup();

    const response = await app.request('/api/rulebook', {
      method: 'PUT',
      headers: { ...OWNER, 'content-type': 'application/json' },
      body: JSON.stringify({ ...defaultRulebook, maxDailyLossUsd: 'a lot' }),
    });

    expect(response.status).toBe(400);
    const body = (await response.json()) as { issues: Array<{ path: string[] }> };
    expect(body.issues[0]?.path).toEqual(['maxDailyLossUsd']);
    expect(ledger.list({ kinds: ['rulebook.set'] })).toEqual([]);
  });

  it('runs a question through to an executed dry run without touching the exchange', async () => {
    const { app, exchange, ledger } = setup();

    const session = await ask(app, 'Should I add a little BNB?');
    expect(session.status).toBe('pending');

    const approved = await app.request(`/api/sessions/${session.id}/approve`, {
      method: 'POST',
      headers: OWNER,
    });

    expect(approved.status).toBe(200);
    expect(await approved.json()).toMatchObject({ id: session.id, status: 'executed' });
    expect(exchange.orders).toEqual([]);
    expect(ledger.list({ kinds: ['order.sent'] })).toHaveLength(1);

    const listed = await app.request('/api/sessions', { headers: OWNER });
    expect((await listed.json()) as unknown[]).toHaveLength(1);
  });

  it('records a rejection and will not act on the session afterwards', async () => {
    const { app, ledger } = setup();
    const session = await ask(app, 'Should I add a little BNB?');

    const rejected = await app.request(`/api/sessions/${session.id}/reject`, {
      method: 'POST',
      headers: { ...OWNER, 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'Too close to the weekend.' }),
    });

    expect(rejected.status).toBe(200);
    expect(await rejected.json()).toMatchObject({ status: 'rejected' });
    expect(ledger.list({ kinds: ['rejection'] })[0]?.payload.reason).toBe(
      'Too close to the weekend.',
    );

    const again = await app.request(`/api/sessions/${session.id}/approve`, {
      method: 'POST',
      headers: OWNER,
    });
    expect(again.status).toBe(409);
  });

  it('stops the agent so an approval is refused, and starts it again', async () => {
    const { app, ledger } = setup();
    const session = await ask(app, 'Should I add a little BNB?');

    const killed = await app.request('/api/kill', { method: 'POST', headers: OWNER });
    expect(await killed.json()).toEqual({ killed: true });

    const approved = await app.request(`/api/sessions/${session.id}/approve`, {
      method: 'POST',
      headers: OWNER,
    });

    expect(approved.status).toBe(200);
    expect(await approved.json()).toMatchObject({ status: 'pending' });
    expect(ledger.list({ kinds: ['order.sent'] })).toEqual([]);

    const health = await app.request('/health');
    expect(await health.json()).toMatchObject({ killed: true });

    const resumed = await app.request('/api/resume', { method: 'POST', headers: OWNER });
    expect(await resumed.json()).toEqual({ killed: false });
  });

  it('pages the ledger, filters it by kind, and proves the chain holds', async () => {
    const { app } = setup();

    for (const name of ['One', 'Two', 'Three']) {
      const response = await app.request('/api/rulebook', {
        method: 'PUT',
        headers: { ...OWNER, 'content-type': 'application/json' },
        body: JSON.stringify({ ...defaultRulebook, name }),
      });
      expect(response.status).toBe(200);
    }

    const first = await app.request('/api/ledger?limit=2', { headers: OWNER });
    const firstPage = (await first.json()) as {
      entries: Array<{ seq: number }>;
      nextAfterSeq: number | null;
    };
    expect(firstPage.entries.map((entry) => entry.seq)).toEqual([1, 2]);
    expect(firstPage.nextAfterSeq).toBe(2);

    const second = await app.request('/api/ledger?afterSeq=2&kinds=rulebook.set', {
      headers: OWNER,
    });
    const secondPage = (await second.json()) as { entries: Array<{ seq: number }> };
    expect(secondPage.entries.map((entry) => entry.seq)).toEqual([3]);

    const bad = await app.request('/api/ledger?kinds=whatever', { headers: OWNER });
    expect(bad.status).toBe(400);

    const verified = await app.request('/api/ledger/verify', { headers: OWNER });
    expect(await verified.json()).toEqual({ ok: true, length: 3 });
  });

  it('reports the account and writes the opening equity only once', async () => {
    const { app, ledger } = setup();

    const first = await app.request('/api/account', { headers: OWNER });
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({
      nowIso: '2026-09-06T12:00:00.000Z',
      killed: false,
      dailyLossUsd: 0,
      dailyDataSpendUsd: 0,
      openPositions: [],
    });

    await app.request('/api/account', { headers: OWNER });

    const notes = ledger.list({ kinds: ['note'] });
    expect(notes).toHaveLength(1);
    expect(notes[0]?.payload).toMatchObject({ kind: 'equity.day_start', equityUsd: 500 });
  });

  it('lets the dashboard origin through the preflight and nobody else', async () => {
    const { app } = setup();
    const preflight = (origin: string) =>
      app.request('/api/ask', {
        method: 'OPTIONS',
        headers: { origin, 'access-control-request-method': 'POST' },
      });

    const dashboard = await preflight('http://localhost:3000');
    expect(dashboard.status).toBe(204);
    expect(dashboard.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
    expect(dashboard.headers.get('access-control-allow-headers')).toContain('Authorization');
    expect(dashboard.headers.get('access-control-allow-methods')).toContain('PUT');

    const stranger = await preflight('https://looks-like-olai.example');
    expect(stranger.headers.get('access-control-allow-origin')).toBeNull();

    const health = await app.request('/health', { headers: { origin: 'http://localhost:3000' } });
    expect(health.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
  });

  it('searches the Bazaar at the rulebook\'s per call cap when the caller names no price', async () => {
    const searches: Array<{ query: string; maxUsdPrice?: number }> = [];
    const bazaar = {
      search: async (q: { query: string; maxUsdPrice?: number }) => {
        searches.push(q);
        return [];
      },
    } as unknown as BazaarClient;

    const { app, rulebooks } = setup({ bazaar });

    const first = await app.request('/api/bazaar/search?query=BNB%20flows', { headers: OWNER });
    expect(first.status).toBe(200);
    expect(searches[0]?.maxUsdPrice).toBe(defaultRulebook.maxDataSpendUsdPerCall);

    rulebooks.save({ ...defaultRulebook, maxDataSpendUsdPerCall: 0.02 }, 'owner');
    await app.request('/api/bazaar/search?query=BNB%20flows', { headers: OWNER });
    expect(searches[1]?.maxUsdPrice).toBe(0.02);

    await app.request('/api/bazaar/search?query=BNB%20flows&maxUsdPrice=0.01', { headers: OWNER });
    expect(searches[2]?.maxUsdPrice).toBe(0.01);
  });

  it('says plainly when there is no session and when there is no wallet', async () => {
    const { app } = setup();

    const missing = await app.request('/api/sessions/ol-nothing', { headers: OWNER });
    expect(missing.status).toBe(404);

    const approve = await app.request('/api/sessions/ol-nothing/approve', {
      method: 'POST',
      headers: OWNER,
    });
    expect(approve.status).toBe(404);

    const wallet = await app.request('/api/wallet', { headers: OWNER });
    expect(wallet.status).toBe(200);
    expect(await wallet.json()).toMatchObject({ status: 'unavailable' });
  });
});
