import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BootError, buildService } from '../../src/boot.js';
import { type Config, loadConfig } from '../../src/config.js';
import type { Proposal } from '../../src/brain/proposal.js';
import { defaultRulebook } from '../../src/rulebook/store.js';
import { Baw } from '../../src/x402/baw.js';
import { fakeAnthropic } from '../brain/fake-anthropic.js';

/**
 * What this file does NOT cover: a real Binance MCP session (no token exists on
 * a test machine, so every service here boots the fake exchange), the real
 * wallet CLI, the real Anthropic API, and the listening HTTP server in
 * src/index.ts, which is exercised by hand with curl instead.
 */

const TOKEN = `ol.${'b'.repeat(40)}`;
const OWNER = { authorization: `Bearer ${TOKEN}` };

const buyBnb: Proposal = {
  summary: 'Add 12 dollars of BNB.',
  reasoning: 'The book is deep enough for a size this small.',
  action: { type: 'order', symbol: 'BNBUSDT', side: 'BUY', quoteUsd: 12, orderType: 'MARKET' },
  confidence: 0.6,
  dataUsed: [],
  risks: ['A weekend gap would hurt this.'],
};

const tempDirs: string[] = [];
const services: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  while (services.length > 0) {
    await services.pop()?.close();
  }
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop() as string, { recursive: true, force: true });
  }
});

/** A wallet that answers without going anywhere near the real CLI. */
function stubBaw(): Baw {
  return new Baw({
    run: async () => ({
      stdout: JSON.stringify({ success: true, data: { status: 'CONNECTED' } }),
      exitCode: 0,
    }),
  });
}

function makeConfig(overrides: Record<string, string> = {}): Config {
  const dir = mkdtempSync(join(tmpdir(), 'olai-boot-'));
  tempDirs.push(dir);

  return loadConfig({
    ANTHROPIC_API_KEY: 'sk-ant-test-key-0123456789',
    OLAI_OWNER_TOKEN: TOKEN,
    OLAI_DB_PATH: join(dir, 'olai.db'),
    OLAI_RULEBOOK_PATH: join(dir, 'rulebook.json'),
    OLAI_TOKEN_PATH: join(dir, 'binance-mcp-token.json'),
    OLAI_WEB_ORIGIN: 'http://localhost:3000',
    ...overrides,
  });
}

async function boot(config: Config, turns = 0) {
  const service = await buildService(config, {
    baw: stubBaw(),
    anthropic: fakeAnthropic(
      Array.from({ length: turns }, () => [{ toolCalls: [{ name: 'propose', input: buyBnb }] }]),
    ).client,
  });
  services.push(service);
  return service;
}

describe('buildService', () => {
  it('boots the fake exchange in a dry run when nobody has signed in to Binance', async () => {
    const service = await boot(makeConfig());

    expect(service.exchange.name).toBe('fake');

    const health = await service.app.request('/health');
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ ok: true, dryRun: true, killed: false });

    // The seeded rulebook is on disk and in the ledger before the first question.
    const rulebook = await service.app.request('/api/rulebook', { headers: OWNER });
    expect(await rulebook.json()).toEqual(defaultRulebook);
    expect(service.ledger.list({ kinds: ['rulebook.set'] })[0]?.actor).toBe('system');
  });

  it('trades through the REST API as soon as an API key and secret are in the settings', async () => {
    const service = await boot(
      makeConfig({
        BINANCE_API_KEY: 'testnet-key-0123456789',
        BINANCE_API_SECRET: 'testnet-secret-0123456789',
      }),
    );

    expect(service.exchange.name).toBe('binance-spot-testnet');
  });

  it('refuses to start live with no Binance connection behind it', async () => {
    const config = makeConfig({ OLAI_DRY_RUN: 'false' });

    await expect(buildService(config, { baw: stubBaw() })).rejects.toThrowError(BootError);
    await expect(buildService(config, { baw: stubBaw() })).rejects.toThrowError(
      /live mode needs a connected Binance exchange \(REST key or MCP session\)/,
    );
  });

  it('serves the oauth routes and the owner API from one address', async () => {
    const service = await boot(makeConfig());

    const metadata = await service.app.request('/oauth/client-metadata.json');
    expect(metadata.status).toBe(200);
    expect(await metadata.json()).toMatchObject({
      client_id: 'http://127.0.0.1:4000/oauth/client-metadata.json',
    });

    const anonymous = await service.app.request('/oauth/status');
    expect(anonymous.status).toBe(401);

    const status = await service.app.request('/oauth/status', { headers: OWNER });
    expect(await status.json()).toMatchObject({ connected: false });

    const refused = await service.app.request('/api/ledger');
    expect(refused.status).toBe(401);
  });

  it('reads the rulebook again on every question, so a PUT lands without a restart', async () => {
    const service = await boot(makeConfig(), 2);

    const roomy = { ...defaultRulebook, maxOrderUsd: 20, maxPositionUsdPerSymbol: 5000 };
    const put = async (rulebook: unknown) =>
      service.app.request('/api/rulebook', {
        method: 'PUT',
        headers: { ...OWNER, 'content-type': 'application/json' },
        body: JSON.stringify(rulebook),
      });

    expect((await put(roomy)).status).toBe(200);

    const ask = async () => {
      const response = await service.app.request('/api/ask', {
        method: 'POST',
        headers: { ...OWNER, 'content-type': 'application/json' },
        body: JSON.stringify({ question: 'Should I add a little BNB?' }),
      });
      expect(response.status).toBe(200);
      return (await response.json()) as { status: string; verdict?: { ruleIds: string[] } };
    };

    expect((await ask()).status).toBe('pending');

    expect((await put({ ...roomy, maxOrderUsd: 5 })).status).toBe(200);

    const tightened = await ask();
    expect(tightened.status).toBe('refused');
    expect(tightened.verdict?.ruleIds).toContain('order.max_size');
  });

  it('publishes every ledger line to the event feed', async () => {
    const service = await boot(makeConfig());

    const stream = await service.app.request('/api/events', { headers: OWNER });
    const reader = (stream.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    expect(decoder.decode((await reader.read()).value)).toContain('event: ready');

    await service.app.request('/api/kill', { method: 'POST', headers: OWNER });

    const chunk = decoder.decode((await reader.read()).value);
    expect(chunk).toContain('event: ledger');
    expect(chunk).toContain('"kind":"kill"');

    await reader.cancel();
  });
});
