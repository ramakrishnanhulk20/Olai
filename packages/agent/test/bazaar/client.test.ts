import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BazaarClient, BazaarError } from '../../src/bazaar/client.js';

// What this file does NOT cover: the live Bazaar, which is exercised by
// scripts/probe-bazaar.ts, and the buying side, which lives in test/x402.
// The fixtures are real responses recorded from the production Bazaar on
// 2026-09-06, so a change in Binance's wire shape will not show up here.

const BASE_URL = 'https://www.binance.com/bapi/ramp/v1/public/ramp/b402';

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));
}

function stubFetch(body: unknown, init?: { status?: number }) {
  const calls: string[] = [];
  const fetchImpl = (async (input: Parameters<typeof fetch>[0]) => {
    calls.push(String(input));
    return new Response(JSON.stringify(body), {
      status: init?.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;

  return { fetchImpl, calls };
}

describe('BazaarClient.search', () => {
  it('unwraps the envelope and prices every listing from its token', async () => {
    const { fetchImpl, calls } = stubFetch(fixture('bazaar-search.json'));
    const client = new BazaarClient({ baseUrl: `${BASE_URL}/`, fetch: fetchImpl });

    const results = await client.search({ query: 'balance' });

    expect(calls[0]).toBe(`${BASE_URL}/bazaar/search?query=balance&limit=20`);
    expect(results).toHaveLength(5);
    expect(results[0]).toMatchObject({
      url: 'https://api.nansen.ai/api/v1/profiler/address/current-balance',
      type: 'http',
      x402Version: 2,
      priceUsd: 0.01,
      walletPayable: true,
    });
    expect(results.map((resource) => resource.priceUsd)).toEqual([0.01, 0.25, 0.1, 0.1, 5]);
  });

  it('keeps only the listings under the price cap and trims to the limit', async () => {
    const { fetchImpl } = stubFetch(fixture('bazaar-search.json'));
    const client = new BazaarClient({ baseUrl: BASE_URL, fetch: fetchImpl });

    const cheap = await client.search({ query: 'balance', maxUsdPrice: 0.05 });
    const capped = await client.search({ query: 'balance', maxUsdPrice: 1, limit: 2 });

    expect(cheap.map((resource) => resource.url)).toEqual([
      'https://api.nansen.ai/api/v1/profiler/address/current-balance',
    ]);
    expect(capped).toHaveLength(2);
  });

  it('marks a listing unpayable when no chain or token the wallet supports is offered', async () => {
    const { fetchImpl } = stubFetch({
      code: '000000',
      message: null,
      data: {
        resources: [
          {
            resource: 'https://example.test/only-ethereum',
            type: 'http',
            x402Version: 2,
            description: 'Ethereum only, which the Binance wallet cannot sign',
            accepts: [
              {
                scheme: 'exact',
                network: 'eip155:1',
                asset: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
                maxAmountRequired: '10000',
                payTo: '0x0000000000000000000000000000000000000001',
              },
            ],
            lastUpdated: 1788514484324,
          },
        ],
      },
      success: true,
    });
    const client = new BazaarClient({ baseUrl: BASE_URL, fetch: fetchImpl });

    const results = await client.search({ query: 'anything' });

    expect(results[0]).toMatchObject({ walletPayable: false, priceUsd: null });
  });

  it('throws a typed error when the Bazaar answers with a failure code', async () => {
    const { fetchImpl } = stubFetch({
      code: '000002',
      message: 'illegal parameter',
      data: null,
      success: false,
    });
    const client = new BazaarClient({ baseUrl: BASE_URL, fetch: fetchImpl });

    await expect(client.search({ query: 'balance' })).rejects.toThrowError(BazaarError);
    await expect(client.search({ query: 'balance' })).rejects.toThrowError(/illegal parameter/);
  });
});

describe('BazaarClient.list', () => {
  it('returns the page of resources and the catalog total', async () => {
    const { fetchImpl, calls } = stubFetch(fixture('bazaar-resources.json'));
    const client = new BazaarClient({ baseUrl: BASE_URL, fetch: fetchImpl });

    const page = await client.list({ limit: 3 });

    expect(calls[0]).toBe(`${BASE_URL}/bazaar/resources?limit=3&offset=0`);
    expect(page.total).toBe(979);
    expect(page.items.map((item) => item.url)).toEqual([
      'https://pro.cournot.ai/intelligence/v1/probability',
      'https://api.nansen.ai/api/v1/profiler/address/current-balance',
      'https://pro-api.coinmarketcap.com/x402/v1/dex/search',
    ]);
    expect(page.items.every((item) => item.walletPayable)).toBe(true);
  });
});
