import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

// What this file does NOT cover: the HTTP server in src/index.ts, and whether
// the default URLs are reachable. Those belong to later work orders.

const OWNER_TOKEN = `ol.${'t'.repeat(40)}`;

describe('loadConfig', () => {
  it('fills in every default when only the key and the owner token are given', () => {
    const config = loadConfig({
      ANTHROPIC_API_KEY: 'sk-ant-test-key-0123456789',
      OLAI_OWNER_TOKEN: OWNER_TOKEN,
    });

    expect(config).toEqual({
      ANTHROPIC_API_KEY: 'sk-ant-test-key-0123456789',
      OLAI_OWNER_TOKEN: OWNER_TOKEN,
      OLAI_PORT: 4000,
      OLAI_DB_PATH: './data/olai.db',
      OLAI_RULEBOOK_PATH: './data/rulebook.json',
      OLAI_DRY_RUN: true,
      OLAI_WEB_ORIGIN: 'http://localhost:3000',
      OLAI_TRUST_PROXY: false,
      OLAI_EXCHANGE: 'auto',
      BINANCE_API_ENV: 'testnet',
      BINANCE_MCP_URL: 'https://agent.binance.com/mcp/agentic',
      OLAI_PUBLIC_BASE_URL: 'http://127.0.0.1:4000',
      OLAI_TOKEN_PATH: './data/binance-mcp-token.json',
      OLAI_CLIENT_NAME: 'Olai',
      BAZAAR_BASE_URL: 'https://www.binance.com/bapi/ramp/v1/public/ramp/b402',
    });
  });

  it('ignores a leftover data budget line, since the rulebook is the only cap now', () => {
    const config = loadConfig({
      ANTHROPIC_API_KEY: 'sk-ant-test-key-0123456789',
      OLAI_OWNER_TOKEN: OWNER_TOKEN,
      OLAI_X402_DAILY_BUDGET_USD: '5',
    });

    expect(config).not.toHaveProperty('OLAI_X402_DAILY_BUDGET_USD');
  });

  it('refuses to load without the Anthropic key and names it in the error', () => {
    expect(() => loadConfig({ OLAI_PORT: '4100' })).toThrowError(/ANTHROPIC_API_KEY/);
  });

  it('refuses an owner token that would leave the API weakly locked', () => {
    const withToken = (token: string) =>
      loadConfig({ ANTHROPIC_API_KEY: 'sk-ant-test-key-0123456789', OLAI_OWNER_TOKEN: token });

    expect(() => withToken('hunter2hunter2hunter2hunter2')).toThrowError(/ol\./);
    expect(() => withToken('ol.short')).toThrowError(/24 characters/);
  });
});
