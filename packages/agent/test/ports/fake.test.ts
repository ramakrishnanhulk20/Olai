import { describe, expect, it } from 'vitest';
import { FakeData, FakeExchange, FakeExchangeError, fakeResource } from '../../src/ports/fake.js';

/**
 * What this file does NOT cover: the real Binance exchange port and the real
 * Bazaar and wallet ports, which are separate work. These tests only pin the
 * behaviour the brain and session tests lean on.
 */

describe('FakeExchange', () => {
  it('gives the same numbers every time and says so when a symbol is unknown', async () => {
    const exchange = new FakeExchange();

    const first = await exchange.ticker('BNBUSDT');
    const second = await exchange.ticker('BNBUSDT');
    expect(first).toEqual(second);

    const candles = await exchange.klines('BNBUSDT', '1h', 5);
    expect(candles).toHaveLength(5);
    expect(candles).toEqual(await exchange.klines('BNBUSDT', '1h', 5));

    await expect(exchange.ticker('DOGEUSDT')).rejects.toBeInstanceOf(FakeExchangeError);
  });

  it('records every order it is asked to place, repeats included', async () => {
    const exchange = new FakeExchange();
    const req = {
      symbol: 'BNBUSDT',
      side: 'BUY' as const,
      type: 'MARKET' as const,
      quoteUsd: 40,
      clientOrderId: 'ol-1',
    };

    const result = await exchange.placeOrder(req);
    await exchange.placeOrder(req);

    expect(exchange.orders).toHaveLength(2);
    expect(result.status).toBe('FILLED');
    expect(result.executedQuoteUsd).toBe(40);
    expect(await exchange.orderStatus('BNBUSDT', result.orderId)).toEqual(result);
  });
});

describe('FakeData', () => {
  it('only returns listings that fit the price cap and refuses to pay above it', async () => {
    const url = 'https://merchant.example/flows';
    const data = new FakeData({
      resources: [
        fakeResource({ url, description: 'BNB flows', priceUsd: 0.05 }),
        fakeResource({ url: 'https://merchant.example/pricey', description: 'BNB flows', priceUsd: 2 }),
      ],
      outcomes: {
        [url]: {
          status: 'paid',
          data: { ok: true },
          costUsd: 0.05,
          txHash: '0x1',
          paymentId: 'pay-1',
          option: { index: 1, status: 'READY_TO_SIGN', reasons: [], scheme: 'eip3009' },
          settlement: {},
        },
      },
    });

    const found = await data.search({ query: 'flows', maxUsdPrice: 0.1 });
    expect(found.map((resource) => resource.url)).toEqual([url]);

    const overCap = await data.buy({ url }, 0.01);
    expect(overCap.status).toBe('refused');

    const paid = await data.buy({ url }, 0.05);
    expect(paid.status).toBe('paid');
  });
});
