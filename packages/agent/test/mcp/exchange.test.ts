import { describe, expect, it } from 'vitest';
import type { BinanceMcp } from '../../src/mcp/client.js';
import { ExchangeShapeError, McpExchange } from '../../src/mcp/exchange.js';
import type { ToolMap } from '../../src/mcp/toolmap.js';

// What this file does NOT cover: the real answers from Binance's tools, whose
// field names are not published anywhere. The payloads below are shaped like
// Binance's REST responses, which is the best evidence available until the live
// tool list is captured. The point proven here is that a good shape becomes an
// exact port type and a bad shape is refused, never silently turned into NaN.

const MAP: ToolMap = {
  ticker: 'get_ticker',
  orderBook: 'get_order_book',
  klines: 'get_klines',
  balances: 'get_account_balances',
  positions: 'get_positions',
  placeOrder: 'place_spot_order',
  orderStatus: 'query_order',
};

interface Call {
  name: string;
  args: Record<string, unknown>;
}

function exchangeOver(answers: Record<string, unknown>, opts?: { quoteAsset?: string }) {
  const calls: Call[] = [];
  const mcp = {
    async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
      calls.push({ name, args });
      if (!(name in answers)) throw new Error(`no fake answer for ${name}`);
      return answers[name];
    },
  } as unknown as BinanceMcp;

  return { exchange: new McpExchange(mcp, MAP, opts), calls };
}

describe('McpExchange', () => {
  it('is named for the venue it speaks to', () => {
    expect(exchangeOver({}).exchange.name).toBe('binance-mcp');
  });

  it('turns a Binance shaped ticker answer into a Ticker', async () => {
    const { exchange, calls } = exchangeOver({
      get_ticker: {
        symbol: 'BTCUSDT',
        lastPrice: '64000.10',
        priceChangePercent: '-1.25',
        highPrice: '65100.00',
        lowPrice: '63200.55',
        quoteVolume: '1840000000.12',
        closeTime: 1_700_000_000_000,
      },
    });

    expect(await exchange.ticker('BTCUSDT')).toEqual({
      symbol: 'BTCUSDT',
      price: 64000.1,
      change24hPct: -1.25,
      high24h: 65100,
      low24h: 63200.55,
      volume24hQuote: 1840000000.12,
      asOf: '2023-11-14T22:13:20.000Z',
    });
    expect(calls[0]).toEqual({ name: 'get_ticker', args: { symbol: 'BTCUSDT' } });
  });

  it('completes a bare asset into a pair and leaves a real pair alone', async () => {
    const answer = {
      lastPrice: '1',
      priceChangePercent: '0',
      highPrice: '1',
      lowPrice: '1',
      quoteVolume: '1',
      closeTime: 1_700_000_000_000,
    };
    const { exchange, calls } = exchangeOver({ get_ticker: answer });

    await exchange.ticker('btc');
    await exchange.ticker('eth/usdt');
    await exchange.ticker('ETHBTC');

    expect(calls.map((call) => call.args['symbol'])).toEqual(['BTCUSDT', 'ETHUSDT', 'ETHBTC']);
  });

  it('honours a different quote asset', async () => {
    const { exchange, calls } = exchangeOver(
      {
        get_ticker: {
          lastPrice: '1',
          priceChangePercent: '0',
          highPrice: '1',
          lowPrice: '1',
          quoteVolume: '1',
          closeTime: 1_700_000_000_000,
        },
      },
      { quoteAsset: 'USDC' },
    );

    await exchange.ticker('SOL');

    expect(calls[0]?.args['symbol']).toBe('SOLUSDC');
  });

  it('refuses a ticker answer that is missing the price', async () => {
    const { exchange } = exchangeOver({
      get_ticker: { symbol: 'BTCUSDT', highPrice: '1', lowPrice: '1', quoteVolume: '1' },
    });

    await expect(exchange.ticker('BTCUSDT')).rejects.toThrow(ExchangeShapeError);
  });

  it('refuses a ticker answer whose price is not a number', async () => {
    const { exchange } = exchangeOver({
      get_ticker: {
        symbol: 'BTCUSDT',
        lastPrice: 'not-a-price',
        priceChangePercent: '0',
        highPrice: '1',
        lowPrice: '1',
        quoteVolume: '1',
      },
    });

    await expect(exchange.ticker('BTCUSDT')).rejects.toThrow(/is not a number/);
  });

  it('turns an order book answer into numbered levels and trims it to the depth asked for', async () => {
    const { exchange } = exchangeOver({
      get_order_book: {
        lastUpdateId: 42,
        time: 1_700_000_000_000,
        bids: [
          ['63999.10', '0.5'],
          ['63998.00', '1.25'],
          ['63997.00', '3'],
        ],
        asks: [
          ['64001.00', '0.75'],
          ['64002.00', '2'],
          ['64003.00', '5'],
        ],
      },
    });

    const book = await exchange.orderBook('BTCUSDT', 2);

    expect(book).toEqual({
      symbol: 'BTCUSDT',
      bids: [
        [63999.1, 0.5],
        [63998, 1.25],
      ],
      asks: [
        [64001, 0.75],
        [64002, 2],
      ],
      asOf: '2023-11-14T22:13:20.000Z',
    });
  });

  it('reads an order book whose levels are objects rather than pairs', async () => {
    const { exchange } = exchangeOver({
      get_order_book: {
        time: 1_700_000_000_000,
        bids: [{ price: '100', qty: '2' }],
        asks: [{ price: '101', quantity: '3' }],
      },
    });

    const book = await exchange.orderBook('BTCUSDT');

    expect(book.bids).toEqual([[100, 2]]);
    expect(book.asks).toEqual([[101, 3]]);
  });

  it('refuses an order book level that has no quantity', async () => {
    const { exchange } = exchangeOver({
      get_order_book: { time: 1_700_000_000_000, bids: [['100']], asks: [['101', '1']] },
    });

    await expect(exchange.orderBook('BTCUSDT')).rejects.toThrow(ExchangeShapeError);
  });

  it('reads klines from Binance positional rows', async () => {
    const { exchange } = exchangeOver({
      get_klines: [[1_700_000_000_000, '100', '110', '95', '105', '12.5', 1_700_000_059_999]],
    });

    expect(await exchange.klines('BTCUSDT', '1m', 1)).toEqual([
      { t: '2023-11-14T22:13:20.000Z', o: 100, h: 110, l: 95, c: 105, v: 12.5 },
    ]);
  });

  it('turns balances into Balance rows and drops the empty ones', async () => {
    const { exchange } = exchangeOver({
      get_account_balances: {
        balances: [
          { asset: 'USDT', free: '250.75', locked: '0' },
          { asset: 'BTC', free: '0.01', locked: '0.002', usdValue: '768.00' },
          { asset: 'DOGE', free: '0', locked: '0' },
        ],
      },
    });

    expect(await exchange.balances()).toEqual([
      { asset: 'USDT', free: 250.75, locked: 0, usdValue: null },
      { asset: 'BTC', free: 0.01, locked: 0.002, usdValue: 768 },
    ]);
  });

  it('refuses a balance row with no asset name', async () => {
    const { exchange } = exchangeOver({
      get_account_balances: { balances: [{ free: '1', locked: '0' }] },
    });

    await expect(exchange.balances()).rejects.toThrow(ExchangeShapeError);
  });

  it('reads a short position from the sign of the amount when the venue reports BOTH', async () => {
    const { exchange } = exchangeOver({
      get_positions: {
        positions: [
          { symbol: 'ETHUSDT', positionSide: 'BOTH', positionAmt: '-2', notional: '-6400' },
          { symbol: 'BTCUSDT', positionSide: 'BOTH', positionAmt: '0', notional: '0' },
        ],
      },
    });

    expect(await exchange.positions()).toEqual([
      { symbol: 'ETHUSDT', side: 'SHORT', qty: 2, usd: 6400 },
    ]);
  });

  it('reports no positions when the server has no positions tool', async () => {
    const mcp = {
      async callTool(): Promise<unknown> {
        throw new Error('should not be called');
      },
    } as unknown as BinanceMcp;
    const spotOnly = new McpExchange(mcp, { ...MAP, positions: undefined });

    expect(await spotOnly.positions()).toEqual([]);
  });

  it('sends a market order sized in dollars, with the client order id, and reads the fill', async () => {
    const { exchange, calls } = exchangeOver({
      place_spot_order: {
        symbol: 'BTCUSDT',
        orderId: 987654,
        status: 'FILLED',
        executedQty: '0.00078',
        cummulativeQuoteQty: '50.00',
      },
    });

    const result = await exchange.placeOrder({
      symbol: 'BTC',
      side: 'BUY',
      type: 'MARKET',
      quoteUsd: 50,
      clientOrderId: 'session-7',
    });

    expect(calls[0]?.args).toMatchObject({
      symbol: 'BTCUSDT',
      side: 'BUY',
      type: 'MARKET',
      quoteOrderQty: 50,
      clientOrderId: 'session-7',
    });
    expect(result.orderId).toBe('987654');
    expect(result.status).toBe('FILLED');
    expect(result.executedQty).toBe(0.00078);
    expect(result.executedQuoteUsd).toBe(50);
    expect(result.avgPrice).toBeCloseTo(64102.56, 2);
    expect(result.raw).toBeDefined();
  });

  it('works out the quantity for a limit order and refuses one with no limit price', async () => {
    const { exchange, calls } = exchangeOver({
      place_spot_order: { orderId: '1', status: 'NEW', executedQty: '0', cummulativeQuoteQty: '0' },
    });

    await exchange.placeOrder({
      symbol: 'BTCUSDT',
      side: 'SELL',
      type: 'LIMIT',
      quoteUsd: 100,
      limitPrice: 50,
      clientOrderId: 'session-8',
    });

    expect(calls[0]?.args).toMatchObject({ price: 50, quantity: 2, timeInForce: 'GTC' });

    await expect(
      exchange.placeOrder({
        symbol: 'BTCUSDT',
        side: 'SELL',
        type: 'LIMIT',
        quoteUsd: 100,
        clientOrderId: 'session-9',
      }),
    ).rejects.toThrow(/limit price/);
  });

  it('refuses an order sized at nothing before it reaches the venue', async () => {
    const { exchange, calls } = exchangeOver({ place_spot_order: {} });

    await expect(
      exchange.placeOrder({
        symbol: 'BTCUSDT',
        side: 'BUY',
        type: 'MARKET',
        quoteUsd: 0,
        clientOrderId: 'session-10',
      }),
    ).rejects.toThrow(ExchangeShapeError);
    expect(calls).toHaveLength(0);
  });

  it('reports no average price for an order that has not filled', async () => {
    const { exchange } = exchangeOver({
      query_order: {
        orderId: 55,
        status: 'NEW',
        executedQty: '0',
        cummulativeQuoteQty: '0',
        price: '0',
      },
    });

    const result = await exchange.orderStatus('BTCUSDT', '55');

    expect(result.status).toBe('NEW');
    expect(result.avgPrice).toBeNull();
  });

  it('refuses an order answer with a status it does not recognise', async () => {
    const { exchange } = exchangeOver({
      query_order: { orderId: 55, status: 'WHO_KNOWS', executedQty: '0', cummulativeQuoteQty: '0' },
    });

    await expect(exchange.orderStatus('BTCUSDT', '55')).rejects.toThrow(ExchangeShapeError);
  });

  it('sees through a code and data wrapper around the real payload', async () => {
    const { exchange } = exchangeOver({
      get_ticker: {
        code: '000000',
        message: null,
        data: {
          symbol: 'BTCUSDT',
          lastPrice: '100',
          priceChangePercent: '2',
          highPrice: '110',
          lowPrice: '90',
          quoteVolume: '1000',
          closeTime: 1_700_000_000_000,
        },
      },
    });

    expect((await exchange.ticker('BTCUSDT')).price).toBe(100);
  });
});
