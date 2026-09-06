import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccountStateSource } from '../../src/account/state.js';
import { createApp } from '../../src/api/app.js';
import { EventHub } from '../../src/api/events.js';
import { Ledger } from '../../src/ledger/ledger.js';
import { FakeData, FakeExchange } from '../../src/ports/fake.js';
import { RulebookStore, defaultRulebook } from '../../src/rulebook/store.js';
import { SessionRunner } from '../../src/session/session.js';
import { fakeAnthropic } from '../brain/fake-anthropic.js';

/**
 * What this file does NOT cover: the fifteen second heartbeat (the test would
 * have to sit and wait for it), reconnection and event replay after a dropped
 * connection, which the dashboard handles by re-reading the ledger, and the
 * behaviour of a real proxy in front of the stream.
 */

const TOKEN = `ol.${'e'.repeat(40)}`;
const OWNER = { authorization: `Bearer ${TOKEN}` };

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

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'olai-events-'));
  tempDirs.push(dir);

  const ledger = new Ledger(':memory:');
  openLedgers.push(ledger);

  const exchange = new FakeExchange();
  const events = new EventHub();
  const account = new AccountStateSource({
    exchange,
    ledger,
    now: () => new Date('2026-09-06T12:00:00.000Z'),
  });

  const runner = new SessionRunner({
    exchange,
    data: new FakeData(),
    ledger,
    rulebook: defaultRulebook,
    anthropic: fakeAnthropic([[]]).client,
    dryRun: true,
    accountState: () => account.snapshot(),
  });

  const app = createApp({
    runner,
    ledger,
    rulebooks: new RulebookStore({ path: join(dir, 'rulebook.json'), ledger }),
    account,
    ownerToken: TOKEN,
    dryRun: true,
    events,
  });

  return { app, events };
}

describe('event stream', () => {
  it('delivers a published event to an open stream and lets go when it closes', async () => {
    const { app, events } = setup();

    const response = await app.request('/api/events', { headers: OWNER });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');

    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();

    const ready = decoder.decode((await reader.read()).value);
    expect(ready).toContain('event: ready');
    expect(events.openStreams).toBe(1);

    events.publish({
      type: 'thinking',
      sessionId: 'ol-1',
      at: '2026-09-06T12:00:01.000Z',
      data: { text: 'Checking the order book' },
    });

    const chunk = decoder.decode((await reader.read()).value);
    expect(chunk).toContain('event: thinking');
    expect(chunk).toContain('Checking the order book');

    await reader.cancel();
    await vi.waitFor(() => expect(events.openStreams).toBe(0));
  });

  it('needs the owner token like every other route', async () => {
    const { app } = setup();

    const response = await app.request('/api/events');
    expect(response.status).toBe(401);
  });

  it('keeps going when one listener throws', () => {
    const hub = new EventHub();
    const seen: string[] = [];

    hub.subscribe(() => {
      throw new Error('this browser has gone away');
    });
    hub.subscribe((event) => seen.push(event.type));

    hub.publish({ type: 'proposal', at: '2026-09-06T12:00:02.000Z', data: {} });

    expect(seen).toEqual(['proposal']);
    expect(hub.openStreams).toBe(1);
  });
});
