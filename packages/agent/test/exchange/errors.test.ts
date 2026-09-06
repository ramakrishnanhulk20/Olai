import { describe, expect, it } from 'vitest';
import { ExchangeApiError, ExchangeRateLimitError } from '../../src/exchange/errors.js';
import { BinanceRestExchange } from '../../src/exchange/rest.js';

// What this file does NOT cover: the live rate limiter, which only shows itself
// under real load, and the weight accounting that decides when Binance starts
// answering 429 in the first place.

function exchangeAnswering(reply: {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}): BinanceRestExchange {
  const fetchImpl = (async () =>
    new Response(JSON.stringify(reply.body), {
      status: reply.status,
      headers: { 'content-type': 'application/json', ...reply.headers },
    })) as unknown as typeof fetch;

  return new BinanceRestExchange({
    baseUrl: 'https://testnet.binance.vision',
    apiKey: 'key',
    apiSecret: 'secret',
    fetch: fetchImpl,
  });
}

describe('REST failures', () => {
  it('turns a 429 into a rate limit error carrying the seconds Binance asked for', async () => {
    const exchange = exchangeAnswering({
      status: 429,
      body: { code: -1003, msg: 'Too many requests; current limit is 1200 request weight per 1 MINUTE.' },
      headers: { 'retry-after': '30' },
    });

    const failure = await exchange.ticker('BNBUSDT').catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ExchangeRateLimitError);
    expect(failure).toBeInstanceOf(ExchangeApiError);
    expect(failure as ExchangeRateLimitError).toMatchObject({
      httpStatus: 429,
      code: -1003,
      retryAfterSeconds: 30,
    });
  });

  it('leaves retryAfterSeconds null when a 418 arrives with no Retry-After header', async () => {
    const exchange = exchangeAnswering({ status: 418, body: { code: -1003, msg: 'IP banned.' } });

    const failure = (await exchange.ticker('BNBUSDT').catch((error: unknown) => error)) as
      ExchangeRateLimitError;

    expect(failure).toBeInstanceOf(ExchangeRateLimitError);
    expect(failure.retryAfterSeconds).toBeNull();
  });

  it('keeps the Binance code and message on an ordinary refusal', async () => {
    const exchange = exchangeAnswering({ status: 400, body: { code: -1121, msg: 'Invalid symbol.' } });

    const failure = (await exchange.ticker('NOPEUSDT').catch((error: unknown) => error)) as
      ExchangeApiError;

    expect(failure).toBeInstanceOf(ExchangeApiError);
    expect(failure).not.toBeInstanceOf(ExchangeRateLimitError);
    expect(failure).toMatchObject({ httpStatus: 400, code: -1121, binanceMessage: 'Invalid symbol.' });
    expect(failure.message).toContain('Invalid symbol.');
  });
});
