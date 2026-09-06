import { afterEach, describe, expect, it } from 'vitest';
import { AccountStateSource } from '../../src/account/state.js';
import { ExchangeApiError } from '../../src/exchange/errors.js';
import { BinanceRestExchange } from '../../src/exchange/rest.js';
import { Ledger } from '../../src/ledger/ledger.js';

/**
 * What this file does NOT cover: the live Binance API, which scripts/probe-exchange.ts
 * exercises, whether a signature is one Binance accepts, and the rate limiter.
 * The bodies below are the documented Spot shapes, so a change in Binance's wire
 * format will not show up here either.
 */

const openLedgers: Ledger[] = [];

afterEach(() => {
  while (openLedgers.length > 0) {
    openLedgers.pop()?.close();
  }
});

const KEY = 'testkeyABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const SECRET = 'testsecretZYXWVUTSRQPONMLKJIHGFEDCBA9876543210';

interface Reply {
  status?: number;
  body?: unknown;
  text?: string;
  headers?: Record<string, string>;
  fail?: Error;
}

type Route = Reply | ((seen: number) => Reply);

interface Call {
  method: string;
  url: string;
  path: string;
  headers: Record<string, string>;
}

function stubFetch(routes: Record<string, Route>) {
  const calls: Call[] = [];
  const seen = new Map<string, number>();

  const fetchImpl = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = new URL(String(input));
    const method = (init?.method ?? 'GET').toUpperCase();
    const key = `${method} ${url.pathname}`;
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    calls.push({
      method,
      url: String(input),
      path: url.pathname,
      headers: { ...((init?.headers as Record<string, string> | undefined) ?? {}) },
    });

    const route = routes[key];
    if (route === undefined) {
      throw new Error(`this test has no route for ${key}`);
    }

    const reply = typeof route === 'function' ? route(count) : route;
    if (reply.fail) {
      throw reply.fail;
    }

    return new Response(reply.text ?? JSON.stringify(reply.body ?? {}), {
      status: reply.status ?? 200,
      headers: { 'content-type': 'application/json', ...reply.headers },
    });
  }) as unknown as typeof fetch;

  return {
    fetchImpl,
    calls,
    count: (method: string, path: string) =>
      calls.filter((call) => call.method === method && call.path === path).length,
    last: (method: string, path: string) =>
      calls.filter((call) => call.method === method && call.path === path).at(-1),
  };
}

function exchangeOn(routes: Record<string, Route>) {
  const stub = stubFetch(routes);
  const exchange = new BinanceRestExchange({
    baseUrl: 'https://testnet.binance.vision',
    apiKey: KEY,
    apiSecret: SECRET,
    fetch: stub.fetchImpl,
    now: () => 1_788_652_800_000,
  });
  return { exchange, stub };
}

const TICKER_24HR = {
  symbol: 'BNBUSDT',
  priceChange: '-8.30000000',
  priceChangePercent: '-1.354',
  weightedAvgPrice: '609.11000000',
  lastPrice: '604.70000000',
  openPrice: '613.00000000',
  highPrice: '620.10000000',
  lowPrice: '598.20000000',
  volume: '52341.10000000',
  quoteVolume: '31882401.23000000',
  openTime: 1_788_566_400_000,
  closeTime: 1_788_652_799_999,
  firstId: 1,
  lastId: 2,
  count: 2,
};

const DEPTH = {
  lastUpdateId: 7_913_402,
  bids: [
    ['604.60000000', '12.10000000'],
    ['604.50000000', '3.40000000'],
  ],
  asks: [
    ['604.70000000', '8.90000000'],
    ['604.80000000', '1.20000000'],
  ],
};

const KLINES = [
  [
    1_788_649_200_000,
    '612.10000000',
    '615.00000000',
    '610.00000000',
    '613.40000000',
    '1234.50000000',
    1_788_652_799_999,
    '757000.00000000',
    1200,
    '600.00000000',
    '368000.00000000',
    '0',
  ],
];

const EXCHANGE_INFO = {
  timezone: 'UTC',
  serverTime: 1_788_652_800_000,
  symbols: [
    {
      symbol: 'BNBUSDT',
      status: 'TRADING',
      baseAsset: 'BNB',
      quoteAsset: 'USDT',
      filters: [
        { filterType: 'PRICE_FILTER', minPrice: '0.10000000', maxPrice: '10000.00000000', tickSize: '0.10000000' },
        { filterType: 'LOT_SIZE', minQty: '0.00100000', maxQty: '9000.00000000', stepSize: '0.00100000' },
        { filterType: 'NOTIONAL', minNotional: '5.00000000', maxNotional: '9000000.00000000' },
      ],
    },
  ],
};

const FILLED_MARKET_ORDER = {
  symbol: 'BNBUSDT',
  orderId: 28_457,
  orderListId: -1,
  clientOrderId: 'olai-session-1',
  transactTime: 1_788_652_800_123,
  price: '0.00000000',
  origQty: '0.01960000',
  executedQty: '0.01960000',
  origQuoteOrderQty: '12.00000000',
  cummulativeQuoteQty: '11.99880000',
  status: 'FILLED',
  timeInForce: 'GTC',
  type: 'MARKET',
  side: 'BUY',
  selfTradePreventionMode: 'NONE',
};

const ACCOUNT = {
  makerCommission: 15,
  canTrade: true,
  balances: [
    { asset: 'USDT', free: '1000.50000000', locked: '0.00000000' },
    { asset: 'BNB', free: '2.50000000', locked: '0.50000000' },
    { asset: 'XRP', free: '0.50000000', locked: '0.00000000' },
    { asset: 'LTC', free: '0.00000000', locked: '0.00000000' },
    { asset: 'NOPE', free: '4.00000000', locked: '0.00000000' },
  ],
};

describe('BinanceRestExchange market reads', () => {
  it('names itself after the network it is pointed at', () => {
    const build = (baseUrl: string) =>
      new BinanceRestExchange({ baseUrl, apiKey: KEY, apiSecret: SECRET }).name;

    expect(build('https://api.binance.com')).toBe('binance-spot');
    expect(build('https://testnet.binance.vision')).toBe('binance-spot-testnet');
    expect(build('https://example.test')).toBe('binance-spot-custom');
  });

  it('reads a 24 hour ticker and dates it from the close time Binance sent', async () => {
    const { exchange, stub } = exchangeOn({ 'GET /api/v3/ticker/24hr': { body: TICKER_24HR } });

    expect(await exchange.ticker('BNBUSDT')).toEqual({
      symbol: 'BNBUSDT',
      price: 604.7,
      change24hPct: -1.354,
      high24h: 620.1,
      low24h: 598.2,
      volume24hQuote: 31_882_401.23,
      asOf: '2026-09-05T23:59:59.999Z',
    });
    expect(stub.last('GET', '/api/v3/ticker/24hr')?.url).toContain('symbol=BNBUSDT');
  });

  it('refuses a ticker whose price is not a number instead of passing on a NaN', async () => {
    const { exchange } = exchangeOn({
      'GET /api/v3/ticker/24hr': { body: { ...TICKER_24HR, lastPrice: 'unavailable' } },
    });

    await expect(exchange.ticker('BNBUSDT')).rejects.toThrowError(ExchangeApiError);
  });

  it('takes the top of the order book and asks Binance for a depth it accepts', async () => {
    const { exchange, stub } = exchangeOn({ 'GET /api/v3/depth': { body: DEPTH } });

    const book = await exchange.orderBook('BNBUSDT', 2);

    expect(book.bids).toEqual([[604.6, 12.1], [604.5, 3.4]]);
    expect(book.asks[0]).toEqual([604.7, 8.9]);
    expect(book.asOf).toBe('2026-09-06T00:00:00.000Z');
    expect(stub.last('GET', '/api/v3/depth')?.url).toContain('limit=5');
  });

  it('refuses an order book level that is missing its quantity', async () => {
    const { exchange } = exchangeOn({
      'GET /api/v3/depth': { body: { ...DEPTH, bids: [['604.60000000']] } },
    });

    await expect(exchange.orderBook('BNBUSDT')).rejects.toThrowError(ExchangeApiError);
  });

  it('turns positional klines into named candles with ISO times', async () => {
    const { exchange, stub } = exchangeOn({ 'GET /api/v3/klines': { body: KLINES } });

    expect(await exchange.klines('BNBUSDT', '1h', 1)).toEqual([
      { t: '2026-09-05T23:00:00.000Z', o: 612.1, h: 615, l: 610, c: 613.4, v: 1234.5 },
    ]);
    expect(stub.last('GET', '/api/v3/klines')?.url).toContain('interval=1h&limit=1');
  });

  it('refuses a kline row that is too short to be a candle', async () => {
    const { exchange } = exchangeOn({
      'GET /api/v3/klines': { body: [[1_788_649_200_000, '612.1', '615.0']] },
    });

    await expect(exchange.klines('BNBUSDT', '1h')).rejects.toThrowError(ExchangeApiError);
  });
});

describe('BinanceRestExchange account reads', () => {
  const accountRoutes: Record<string, Route> = {
    'GET /api/v3/account': { body: ACCOUNT },
    'GET /api/v3/ticker/price': {
      body: [
        { symbol: 'BNBUSDT', price: '600.00000000' },
        { symbol: 'XRPUSDT', price: '1.00000000' },
      ],
    },
  };

  it('gives dollar assets face value and prices everything else in one request', async () => {
    const { exchange, stub } = exchangeOn(accountRoutes);

    const held = await exchange.balances();

    expect(held).toEqual([
      { asset: 'USDT', free: 1000.5, locked: 0, usdValue: 1000.5 },
      { asset: 'BNB', free: 2.5, locked: 0.5, usdValue: 1800 },
      { asset: 'XRP', free: 0.5, locked: 0, usdValue: 0.5 },
      { asset: 'LTC', free: 0, locked: 0, usdValue: 0 },
      { asset: 'NOPE', free: 4, locked: 0, usdValue: null },
    ]);
    // A dollar asset and a zero balance both have a known value, and everything
    // left is priced together, so the whole account costs one price request.
    expect(stub.count('GET', '/api/v3/ticker/price')).toBe(1);
    expect(stub.last('GET', '/api/v3/account')?.headers['X-MBX-APIKEY']).toBe(KEY);
  });

  it('counts a holding as a position once it is worth a whole dollar', async () => {
    const { exchange } = exchangeOn({
      ...accountRoutes,
      // At two dollars, half an XRP is worth exactly one dollar, which is the
      // edge the dust filter sits on.
      'GET /api/v3/ticker/price': {
        body: [
          { symbol: 'BNBUSDT', price: '600.00000000' },
          { symbol: 'XRPUSDT', price: '2.00000000' },
        ],
      },
    });

    expect(await exchange.positions()).toEqual([
      { symbol: 'BNBUSDT', side: 'LONG', qty: 3, usd: 1800 },
      { symbol: 'XRPUSDT', side: 'LONG', qty: 0.5, usd: 1 },
    ]);
  });

  it('prices a dozen holdings in one call and names the one Binance does not list', async () => {
    const coins = [
      'BNB', 'ETH', 'SOL', 'ADA', 'DOT', 'LINK',
      'AVAX', 'ATOM', 'NEAR', 'FIL', 'UNI', 'AAVE',
    ];
    const { exchange, stub } = exchangeOn({
      'GET /api/v3/account': {
        body: {
          balances: [
            { asset: 'USDT', free: '100.00000000', locked: '0.00000000' },
            ...coins.map((asset) => ({ asset, free: '2.00000000', locked: '0.00000000' })),
            { asset: 'NOPE', free: '4.00000000', locked: '0.00000000' },
          ],
        },
      },
      'GET /api/v3/ticker/price': {
        body: coins.map((asset) => ({ symbol: `${asset}USDT`, price: '10.00000000' })),
      },
    });

    const { balances, unpricedAssets } = await exchange.balancesDetailed();

    expect(stub.count('GET', '/api/v3/ticker/price')).toBe(1);
    const asked = decodeURIComponent(stub.last('GET', '/api/v3/ticker/price')?.url ?? '');
    expect(asked).toContain('symbols=["BNBUSDT","ETHUSDT"');
    expect(asked).toContain('"NOPEUSDT"]');
    expect(balances.filter((row) => row.usdValue === 20)).toHaveLength(coins.length);
    expect(unpricedAssets).toEqual(['NOPE']);

    const ledger = new Ledger(':memory:');
    openLedgers.push(ledger);
    const state = await new AccountStateSource({
      exchange,
      ledger,
      now: () => new Date('2026-09-06T12:00:00.000Z'),
    }).snapshot();

    expect(state.openPositions).toHaveLength(coins.length);
    const unpriced = ledger
      .list({ kinds: ['note'] })
      .filter((entry) => entry.payload.kind === 'positions.unpriced');
    expect(unpriced).toHaveLength(1);
    expect(unpriced[0]?.payload.assets).toEqual(['NOPE']);
  });
});

describe('BinanceRestExchange placeOrder', () => {
  const orderRoutes: Record<string, Route> = {
    'GET /api/v3/exchangeInfo': { body: EXCHANGE_INFO },
    'POST /api/v3/order': { body: FILLED_MARKET_ORDER },
  };

  it('sends a market order in dollars, signed, under the id Olai chose', async () => {
    const { exchange, stub } = exchangeOn(orderRoutes);

    const result = await exchange.placeOrder({
      symbol: 'BNBUSDT',
      side: 'BUY',
      type: 'MARKET',
      quoteUsd: 12,
      clientOrderId: 'olai-session-1',
    });

    const sent = stub.last('POST', '/api/v3/order');
    expect(sent?.url).toContain('symbol=BNBUSDT&side=BUY&type=MARKET&quoteOrderQty=12');
    expect(sent?.url).toContain('newClientOrderId=olai-session-1');
    expect(sent?.url).toMatch(/&signature=[0-9a-f]{64}$/);
    expect(sent?.headers['X-MBX-APIKEY']).toBe(KEY);

    expect(result).toMatchObject({
      orderId: '28457',
      status: 'FILLED',
      executedQty: 0.0196,
      executedQuoteUsd: 11.9988,
    });
    expect(result.avgPrice).toBeCloseTo(612.18, 2);
  });

  it('rounds a limit price to the tick and the quantity down to the lot step', async () => {
    const { exchange, stub } = exchangeOn({
      ...orderRoutes,
      'POST /api/v3/order': { body: { ...FILLED_MARKET_ORDER, type: 'LIMIT', status: 'NEW', executedQty: '0.00000000', cummulativeQuoteQty: '0.00000000' } },
    });

    const result = await exchange.placeOrder({
      symbol: 'BNBUSDT',
      side: 'BUY',
      type: 'LIMIT',
      quoteUsd: 50,
      limitPrice: 612.37,
      clientOrderId: 'olai-session-2',
    });

    // 612.37 falls to 612.3 on a 0.1 tick, and 50 / 612.3 is 0.08165..., which
    // falls to 0.081 on a 0.001 lot step.
    const sent = stub.last('POST', '/api/v3/order');
    expect(sent?.url).toContain('quantity=0.081');
    expect(sent?.url).toContain('price=612.3');
    expect(sent?.url).toContain('timeInForce=GTC');
    expect(result.status).toBe('NEW');
    expect(result.avgPrice).toBeNull();
  });

  it('refuses an order under the symbol minimum before anything is sent', async () => {
    const { exchange, stub } = exchangeOn(orderRoutes);

    const failure = (await exchange
      .placeOrder({
        symbol: 'BNBUSDT',
        side: 'BUY',
        type: 'MARKET',
        quoteUsd: 4,
        clientOrderId: 'olai-session-3',
      })
      .catch((error: unknown) => error)) as ExchangeApiError;

    expect(failure).toBeInstanceOf(ExchangeApiError);
    expect(failure.code).toBeNull();
    expect(failure.message).toContain('5');
    expect(stub.count('POST', '/api/v3/order')).toBe(0);
  });

  it('asks what happened rather than sending a second order when the answer is lost', async () => {
    const { exchange, stub } = exchangeOn({
      ...orderRoutes,
      'POST /api/v3/order': { fail: new TypeError('fetch failed') },
      'GET /api/v3/order': { body: { ...FILLED_MARKET_ORDER, status: 'FILLED' } },
    });

    const result = await exchange.placeOrder({
      symbol: 'BNBUSDT',
      side: 'BUY',
      type: 'MARKET',
      quoteUsd: 12,
      clientOrderId: 'olai-session-4',
    });

    expect(result.status).toBe('FILLED');
    expect(stub.count('POST', '/api/v3/order')).toBe(1);
    expect(stub.count('GET', '/api/v3/order')).toBe(1);
    expect(stub.last('GET', '/api/v3/order')?.url).toContain('origClientOrderId=olai-session-4');
  });

  it('gives up on the original failure when the lookup cannot find the order either', async () => {
    const { exchange, stub } = exchangeOn({
      ...orderRoutes,
      'POST /api/v3/order': { fail: new TypeError('fetch failed') },
      'GET /api/v3/order': { status: 400, body: { code: -2013, msg: 'Order does not exist.' } },
    });

    await expect(
      exchange.placeOrder({
        symbol: 'BNBUSDT',
        side: 'BUY',
        type: 'MARKET',
        quoteUsd: 12,
        clientOrderId: 'olai-session-5',
      }),
    ).rejects.toThrowError('fetch failed');
    expect(stub.count('POST', '/api/v3/order')).toBe(1);
    expect(stub.count('GET', '/api/v3/order')).toBe(1);
  });

  it('looks one order up again by the client order id', async () => {
    const { exchange, stub } = exchangeOn({
      'GET /api/v3/order': { body: { ...FILLED_MARKET_ORDER, status: 'PARTIALLY_FILLED' } },
    });

    const result = await exchange.orderStatus('BNBUSDT', 'olai-session-1');

    expect(result.status).toBe('PARTIALLY_FILLED');
    expect(stub.last('GET', '/api/v3/order')?.url).toContain('origClientOrderId=olai-session-1');
    expect(stub.last('GET', '/api/v3/order')?.headers['X-MBX-APIKEY']).toBe(KEY);
  });

  it('never puts the secret on the wire as anything but the signature', async () => {
    const { exchange, stub } = exchangeOn({
      ...orderRoutes,
      'GET /api/v3/account': { body: ACCOUNT },
      'GET /api/v3/ticker/price': { status: 400, body: { code: -1121, msg: 'Invalid symbol.' } },
    });

    await exchange.balances();
    await exchange.placeOrder({
      symbol: 'BNBUSDT',
      side: 'BUY',
      type: 'MARKET',
      quoteUsd: 12,
      clientOrderId: 'olai-session-6',
    });

    expect(stub.calls.length).toBeGreaterThan(2);
    for (const call of stub.calls) {
      expect(call.url).not.toContain(SECRET);
      for (const value of Object.values(call.headers)) {
        expect(value).not.toContain(SECRET);
      }
    }
  });
});
