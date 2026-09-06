import { describe, expect, it } from 'vitest';
import { cmcQuotesLatest, cmcQuotesLatestSchema } from '../../src/x402/merchants/cmc.js';
import { hintFor } from '../../src/x402/merchants/hints.js';
import {
  nansenCurrentBalance,
  nansenCurrentBalanceSchema,
} from '../../src/x402/merchants/nansen.js';

// What this file does NOT cover: whether the merchants accept these exact bodies
// once paid. Both were probed unpaid on 2026-09-06 and answered 402, which proves
// the route and the method, not the response shape after payment.

const NANSEN_URL = 'https://api.nansen.ai/api/v1/profiler/address/current-balance';
const CMC_URL = 'https://pro-api.coinmarketcap.com/x402/v3/cryptocurrency/quotes/latest';
const BINANCE_HOT_WALLET = '0x28c6c06298d514db089934071355e5743bf21d60';

describe('hintFor', () => {
  it('gives the proven POST for the Nansen balance endpoint', () => {
    // Does NOT cover whether Nansen still answers this body: only a paid call proves that.
    const hint = hintFor(NANSEN_URL, {});

    expect(hint?.method).toBe('POST');
    expect(hint?.describe).toBe(
      "POST a JSON body {address, chain}; returns the wallet's current token balances",
    );
    expect(hint?.example).toEqual(
      nansenCurrentBalance({ address: BINANCE_HOT_WALLET, chain: 'ethereum' }),
    );

    const withAddress = hintFor(NANSEN_URL, { address: '0x1111111111111111111111111111111111111111' });
    expect((withAddress?.example.body as { address: string }).address).toBe(
      '0x1111111111111111111111111111111111111111',
    );

    // An address the merchant's own schema rejects falls back to the documented one
    // rather than throwing at the model mid session.
    expect(hintFor(NANSEN_URL, { address: 'nonsense' })?.example.body).toEqual(
      nansenCurrentBalance({ address: BINANCE_HOT_WALLET, chain: 'ethereum' }).body,
    );
  });

  it('gives the GET for the CoinMarketCap quote endpoint', () => {
    // Does NOT cover the response shape after payment, only the request Olai sends.
    const hint = hintFor(`${CMC_URL}?symbol=ETH`, { symbol: 'eth' });

    expect(hint?.method).toBe('GET');
    expect(hint?.describe).toBe('GET with ?symbol=; returns the latest quote');
    expect(hint?.example).toEqual(cmcQuotesLatest({ symbol: 'ETH' }));
    expect(hintFor(CMC_URL, {})?.example.url).toBe(cmcQuotesLatest({ symbol: 'BNB' }).url);
  });

  it('has nothing to say about a merchant Olai has never paid', () => {
    // Does NOT cover merchants we may prove later: each one needs its own hint.
    expect(hintFor('https://api.example.com/v1/anything', {})).toBeNull();
    expect(hintFor('', { symbol: 'BNB' })).toBeNull();
  });
});

describe('nansenCurrentBalance', () => {
  it('builds the POST the merchant answers with a 402', () => {
    const request = nansenCurrentBalance({
      address: '0x28c6c06298d514db089934071355e5743bf21d60',
      chain: 'ethereum',
    });

    expect(request).toEqual({
      url: 'https://api.nansen.ai/api/v1/profiler/address/current-balance',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: {
        address: '0x28c6c06298d514db089934071355e5743bf21d60',
        chain: 'ethereum',
        hide_spam_token: true,
        pagination: { page: 1, per_page: 10 },
      },
    });
  });

  it('rejects an address that does not belong to the chain it was given with', () => {
    expect(() => nansenCurrentBalance({ address: 'not-an-address', chain: 'bsc' })).toThrowError();
    expect(
      nansenCurrentBalanceSchema.safeParse({
        address: 'A4x6wNMfJbiZsMRN9XVXvoyYfqXiYV5kqhvnVBNLreWG',
        chain: 'solana',
      }).success,
    ).toBe(true);
  });
});

describe('cmcQuotesLatest', () => {
  it('puts the ticker on the query string in upper case', () => {
    expect(cmcQuotesLatest({ symbol: 'bnb' })).toEqual({
      url: 'https://pro-api.coinmarketcap.com/x402/v3/cryptocurrency/quotes/latest?symbol=BNB',
      method: 'GET',
    });
  });

  it('refuses anything that is not a ticker list', () => {
    expect(cmcQuotesLatestSchema.safeParse({ symbol: 'BNB,ETH' }).success).toBe(true);
    expect(cmcQuotesLatestSchema.safeParse({ symbol: 'BNB&limit=1' }).success).toBe(false);
    expect(cmcQuotesLatestSchema.safeParse({ symbol: '' }).success).toBe(false);
  });
});
