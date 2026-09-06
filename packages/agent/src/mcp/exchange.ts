import { z } from 'zod';
import type {
  Balance,
  ExchangePort,
  Kline,
  OrderBookTop,
  OrderRequest,
  OrderResult,
  Position,
  Ticker,
} from '../ports/exchange.js';
import type { BinanceMcp } from './client.js';
import type { ToolMap } from './toolmap.js';

/**
 * The Binance MCP server seen as Olai's exchange door.
 *
 * Two jobs only: turn a port call into a tool call through the ToolMap, and turn
 * whatever the tool answers into the exact port types. Nothing here trusts a
 * shape. Binance has not published the tool schemas, so every field is read
 * through a list of plausible names and then piped into a strict schema. If a
 * field is missing or unreadable the call fails loudly here rather than handing
 * the trading brain a NaN price.
 */

export class ExchangeShapeError extends Error {
  constructor(
    readonly tool: string,
    readonly detail: string,
  ) {
    super(`The MCP tool "${tool}" answered in a shape Olai cannot read: ${detail}`);
    this.name = 'ExchangeShapeError';
  }
}

const numeric = z
  .union([z.number(), z.string()])
  .transform((value) => (typeof value === 'number' ? value : Number(value.trim())))
  .refine((value) => Number.isFinite(value), 'is not a number');

const timestampish = z.union([z.number(), z.string()]);

function first<T>(...values: Array<T | undefined | null>): T | undefined {
  for (const value of values) {
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

/**
 * Turns whatever a venue calls a timestamp into an ISO string.
 *
 * Binance sends milliseconds since the epoch, but a wrapper may send seconds or
 * an ISO string, so all three are accepted. Anything under this cutoff has to be
 * seconds: as milliseconds it would be 1973.
 */
const SECONDS_CUTOFF = 1e11;

function isoFrom(value: number | string | undefined): string | undefined {
  if (value === undefined) return new Date().toISOString();

  const asNumber = typeof value === 'number' ? value : Number(value.trim());
  if (Number.isFinite(asNumber) && (typeof value === 'number' || value.trim() !== '')) {
    const ms = asNumber < SECONDS_CUTOFF ? asNumber * 1000 : asNumber;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }

  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString();
}

/**
 * Strips a `{ code, message, data }` style wrapper.
 *
 * Only strips when every other key is wrapper furniture, so a real payload that
 * happens to carry a `data` field is left alone.
 */
const WRAPPER_KEYS = new Set(['code', 'message', 'msg', 'success', 'status', 'error']);

function unwrap(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return raw;

  const record = raw as Record<string, unknown>;
  for (const key of ['data', 'result', 'payload'] as const) {
    if (!(key in record)) continue;
    const others = Object.keys(record).filter((other) => other !== key);
    if (others.every((other) => WRAPPER_KEYS.has(other))) return unwrap(record[key]);
  }
  return raw;
}

function parseTool<T>(schema: z.ZodType<T>, raw: unknown, tool: string): T {
  const result = schema.safeParse(unwrap(raw));
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'value'} ${issue.message}`)
      .join('; ');
    throw new ExchangeShapeError(tool, detail);
  }
  return result.data;
}

function pickArray(raw: unknown, keys: string[], tool: string): unknown[] {
  const value = unwrap(raw);
  if (Array.isArray(value)) return value;

  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    for (const key of keys) {
      if (Array.isArray(record[key])) return record[key];
    }
  }

  throw new ExchangeShapeError(tool, `expected a list, or an object holding one under ${keys.join(' or ')}`);
}

const tickerSchema = z.object({
  symbol: z.string().min(1),
  price: z.number(),
  change24hPct: z.number(),
  high24h: z.number(),
  low24h: z.number(),
  volume24hQuote: z.number(),
  asOf: z.string().min(1),
});

function tickerFromTool(symbol: string) {
  return z
    .looseObject({
      symbol: z.string().optional(),
      lastPrice: numeric.optional(),
      price: numeric.optional(),
      close: numeric.optional(),
      last: numeric.optional(),
      priceChangePercent: numeric.optional(),
      changePercent: numeric.optional(),
      change24hPct: numeric.optional(),
      priceChangePct: numeric.optional(),
      highPrice: numeric.optional(),
      high: numeric.optional(),
      high24h: numeric.optional(),
      lowPrice: numeric.optional(),
      low: numeric.optional(),
      low24h: numeric.optional(),
      quoteVolume: numeric.optional(),
      quoteAssetVolume: numeric.optional(),
      volume24hQuote: numeric.optional(),
      quoteVolume24h: numeric.optional(),
      closeTime: timestampish.optional(),
      time: timestampish.optional(),
      timestamp: timestampish.optional(),
      asOf: timestampish.optional(),
    })
    .transform((raw) => ({
      symbol: first(raw.symbol, symbol),
      price: first(raw.lastPrice, raw.price, raw.close, raw.last),
      change24hPct: first(raw.priceChangePercent, raw.changePercent, raw.change24hPct, raw.priceChangePct),
      high24h: first(raw.highPrice, raw.high, raw.high24h),
      low24h: first(raw.lowPrice, raw.low, raw.low24h),
      volume24hQuote: first(raw.quoteVolume, raw.quoteAssetVolume, raw.volume24hQuote, raw.quoteVolume24h),
      asOf: isoFrom(first(raw.closeTime, raw.time, raw.timestamp, raw.asOf)),
    }))
    .pipe(tickerSchema);
}

const level = z.union([
  z
    .array(numeric)
    .min(2)
    .transform((entry) => [entry[0], entry[1]])
    .pipe(z.tuple([z.number(), z.number()])),
  z
    .looseObject({
      price: numeric.optional(),
      p: numeric.optional(),
      quantity: numeric.optional(),
      qty: numeric.optional(),
      amount: numeric.optional(),
      size: numeric.optional(),
      q: numeric.optional(),
    })
    .transform((entry) => [
      first(entry.price, entry.p),
      first(entry.quantity, entry.qty, entry.amount, entry.size, entry.q),
    ])
    .pipe(z.tuple([z.number(), z.number()])),
]);

const orderBookSchema = z.object({
  symbol: z.string().min(1),
  bids: z.array(z.tuple([z.number(), z.number()])),
  asks: z.array(z.tuple([z.number(), z.number()])),
  asOf: z.string().min(1),
});

function orderBookFromTool(symbol: string, depth: number) {
  return z
    .looseObject({
      symbol: z.string().optional(),
      bids: z.array(level).optional(),
      asks: z.array(level).optional(),
      b: z.array(level).optional(),
      a: z.array(level).optional(),
      time: timestampish.optional(),
      timestamp: timestampish.optional(),
      transactTime: timestampish.optional(),
      asOf: timestampish.optional(),
    })
    .transform((raw) => ({
      symbol: first(raw.symbol, symbol),
      bids: first(raw.bids, raw.b)?.slice(0, depth),
      asks: first(raw.asks, raw.a)?.slice(0, depth),
      asOf: isoFrom(first(raw.time, raw.timestamp, raw.transactTime, raw.asOf)),
    }))
    .pipe(orderBookSchema);
}

const klineSchema = z.object({
  t: z.string().min(1),
  o: z.number(),
  h: z.number(),
  l: z.number(),
  c: z.number(),
  v: z.number(),
});

// Binance's REST klines are positional arrays: open time, open, high, low, close,
// volume. A wrapper may name the fields instead, so both are accepted.
const klineFromTool = z.union([
  z
    .array(z.union([z.number(), z.string()]))
    .min(6)
    .transform((row) => ({
      t: isoFrom(row[0]),
      o: Number(row[1]),
      h: Number(row[2]),
      l: Number(row[3]),
      c: Number(row[4]),
      v: Number(row[5]),
    }))
    .pipe(klineSchema),
  z
    .looseObject({
      openTime: timestampish.optional(),
      time: timestampish.optional(),
      t: timestampish.optional(),
      open: numeric.optional(),
      o: numeric.optional(),
      high: numeric.optional(),
      h: numeric.optional(),
      low: numeric.optional(),
      l: numeric.optional(),
      close: numeric.optional(),
      c: numeric.optional(),
      volume: numeric.optional(),
      v: numeric.optional(),
    })
    .transform((raw) => ({
      t: isoFrom(first(raw.openTime, raw.time, raw.t)),
      o: first(raw.open, raw.o),
      h: first(raw.high, raw.h),
      l: first(raw.low, raw.l),
      c: first(raw.close, raw.c),
      v: first(raw.volume, raw.v),
    }))
    .pipe(klineSchema),
]);

const balanceSchema = z.object({
  asset: z.string().min(1),
  free: z.number(),
  locked: z.number(),
  usdValue: z.number().nullable(),
});

const balanceFromTool = z
  .looseObject({
    asset: z.string().optional(),
    coin: z.string().optional(),
    currency: z.string().optional(),
    symbol: z.string().optional(),
    free: numeric.optional(),
    available: numeric.optional(),
    availableBalance: numeric.optional(),
    freeBalance: numeric.optional(),
    locked: numeric.optional(),
    frozen: numeric.optional(),
    onOrder: numeric.optional(),
    lockedBalance: numeric.optional(),
    usdValue: numeric.optional(),
    usd: numeric.optional(),
    usdtValue: numeric.optional(),
    valueUsd: numeric.optional(),
    notional: numeric.optional(),
  })
  .transform((raw) => ({
    asset: first(raw.asset, raw.coin, raw.currency, raw.symbol),
    free: first(raw.free, raw.available, raw.availableBalance, raw.freeBalance),
    locked: first(raw.locked, raw.frozen, raw.onOrder, raw.lockedBalance) ?? 0,
    usdValue: first(raw.usdValue, raw.usd, raw.usdtValue, raw.valueUsd, raw.notional) ?? null,
  }))
  .pipe(balanceSchema);

const positionSchema = z.object({
  symbol: z.string().min(1),
  side: z.enum(['LONG', 'SHORT']),
  qty: z.number(),
  usd: z.number(),
});

const positionFromTool = z
  .looseObject({
    symbol: z.string().optional(),
    pair: z.string().optional(),
    positionSide: z.string().optional(),
    side: z.string().optional(),
    positionAmt: numeric.optional(),
    positionAmount: numeric.optional(),
    qty: numeric.optional(),
    quantity: numeric.optional(),
    size: numeric.optional(),
    amount: numeric.optional(),
    notional: numeric.optional(),
    notionalValue: numeric.optional(),
    positionValue: numeric.optional(),
    usdValue: numeric.optional(),
    usd: numeric.optional(),
    markPrice: numeric.optional(),
    entryPrice: numeric.optional(),
  })
  .transform((raw) => {
    const signed = first(raw.positionAmt, raw.positionAmount, raw.qty, raw.quantity, raw.size, raw.amount);
    const declared = (first(raw.positionSide, raw.side) ?? '').toUpperCase();
    // BOTH is Binance's one-way mode, where only the sign of the amount says
    // which way the position leans.
    const side =
      declared === 'LONG' || declared === 'BUY'
        ? 'LONG'
        : declared === 'SHORT' || declared === 'SELL'
          ? 'SHORT'
          : signed !== undefined && signed < 0
            ? 'SHORT'
            : 'LONG';
    const qty = signed === undefined ? undefined : Math.abs(signed);
    const price = first(raw.markPrice, raw.entryPrice);
    const usd = first(raw.notional, raw.notionalValue, raw.positionValue, raw.usdValue, raw.usd);

    return {
      symbol: first(raw.symbol, raw.pair),
      side,
      qty,
      usd: usd === undefined ? (qty !== undefined && price !== undefined ? qty * price : undefined) : Math.abs(usd),
    };
  })
  .pipe(positionSchema);

const STATUS_BY_VENUE_WORD: Record<string, OrderResult['status']> = {
  NEW: 'NEW',
  PENDING_NEW: 'NEW',
  ACCEPTED: 'NEW',
  PENDING_CANCEL: 'NEW',
  PARTIALLY_FILLED: 'PARTIALLY_FILLED',
  PARTIAL: 'PARTIALLY_FILLED',
  FILLED: 'FILLED',
  REJECTED: 'REJECTED',
  CANCELED: 'CANCELED',
  CANCELLED: 'CANCELED',
  // An expired order will never fill and holds no funds, so it is dead in the
  // same way a cancelled one is.
  EXPIRED: 'CANCELED',
  EXPIRED_IN_MATCH: 'CANCELED',
};

const orderCoreSchema = z.object({
  orderId: z.string().min(1),
  status: z.enum(['FILLED', 'PARTIALLY_FILLED', 'NEW', 'REJECTED', 'CANCELED']),
  executedQty: z.number(),
  executedQuoteUsd: z.number(),
  avgPrice: z.number().nullable(),
});

const orderFromTool = z
  .looseObject({
    orderId: z.union([z.string(), z.number()]).optional(),
    order_id: z.union([z.string(), z.number()]).optional(),
    orderID: z.union([z.string(), z.number()]).optional(),
    id: z.union([z.string(), z.number()]).optional(),
    clientOrderId: z.string().optional(),
    status: z.string().optional(),
    orderStatus: z.string().optional(),
    state: z.string().optional(),
    executedQty: numeric.optional(),
    executedQuantity: numeric.optional(),
    filledQty: numeric.optional(),
    cumQty: numeric.optional(),
    cummulativeQuoteQty: numeric.optional(),
    cumulativeQuoteQty: numeric.optional(),
    cumQuote: numeric.optional(),
    executedQuoteQty: numeric.optional(),
    quoteQty: numeric.optional(),
    avgPrice: numeric.optional(),
    averagePrice: numeric.optional(),
    price: numeric.optional(),
  })
  .transform((raw) => {
    const id = first(raw.orderId, raw.order_id, raw.orderID, raw.id, raw.clientOrderId);
    const word = (first(raw.status, raw.orderStatus, raw.state) ?? '').toUpperCase();
    const executedQty = first(raw.executedQty, raw.executedQuantity, raw.filledQty, raw.cumQty) ?? 0;
    const executedQuoteUsd =
      first(raw.cummulativeQuoteQty, raw.cumulativeQuoteQty, raw.cumQuote, raw.executedQuoteQty, raw.quoteQty) ?? 0;
    const stated = first(raw.avgPrice, raw.averagePrice, raw.price);
    // A venue reports 0 for the average price of an order that has not filled,
    // and 0 as a price would be a lie to the ledger.
    const avgPrice =
      stated !== undefined && stated > 0
        ? stated
        : executedQty > 0 && executedQuoteUsd > 0
          ? executedQuoteUsd / executedQty
          : null;

    return {
      orderId: id === undefined ? undefined : String(id),
      status: STATUS_BY_VENUE_WORD[word],
      executedQty,
      executedQuoteUsd,
      avgPrice,
    };
  })
  .pipe(orderCoreSchema);

/**
 * Quote assets Binance actually lists pairs against. Used only to tell a bare
 * base asset ("BTC") from a complete pair ("ETHBTC"), so that "BTC" becomes
 * "BTCUSDT" but "ETHBTC" is left alone.
 */
const KNOWN_QUOTE_ASSETS = ['USDT', 'USDC', 'FDUSD', 'TUSD', 'BUSD', 'BNB', 'BTC', 'ETH', 'TRY', 'EUR'];

const DEFAULT_DEPTH = 5;

export class McpExchange implements ExchangePort {
  readonly name = 'binance-mcp';

  private readonly quoteAsset: string;

  constructor(
    private readonly mcp: BinanceMcp,
    private readonly map: ToolMap,
    opts: { quoteAsset?: string } = {},
  ) {
    this.quoteAsset = (opts.quoteAsset ?? 'USDT').toUpperCase();
  }

  /** Last price and the 24 hour numbers for one pair. */
  async ticker(symbol: string): Promise<Ticker> {
    const pair = this.pairFor(symbol);
    const raw = await this.mcp.callTool(this.map.ticker, { symbol: pair });
    return parseTool(tickerFromTool(pair), raw, this.map.ticker);
  }

  /** The top of the book, trimmed to `depth` levels a side. */
  async orderBook(symbol: string, depth = DEFAULT_DEPTH): Promise<OrderBookTop> {
    const pair = this.pairFor(symbol);
    const raw = await this.mcp.callTool(this.map.orderBook, { symbol: pair, limit: depth });
    return parseTool(orderBookFromTool(pair, depth), raw, this.map.orderBook);
  }

  async klines(symbol: string, interval: string, limit = 100): Promise<Kline[]> {
    const pair = this.pairFor(symbol);
    const raw = await this.mcp.callTool(this.map.klines, { symbol: pair, interval, limit });
    const rows = pickArray(raw, ['klines', 'candles', 'bars', 'list', 'items'], this.map.klines);
    return rows.map((row) => parseTool(klineFromTool, row, this.map.klines));
  }

  /** Every asset the account holds. Zero balances are dropped: they are noise. */
  async balances(): Promise<Balance[]> {
    const raw = await this.mcp.callTool(this.map.balances, {});
    const rows = pickArray(raw, ['balances', 'assets', 'list', 'items'], this.map.balances);
    return rows
      .map((row) => parseTool(balanceFromTool, row, this.map.balances))
      .filter((balance) => balance.free !== 0 || balance.locked !== 0);
  }

  /**
   * Open leveraged positions.
   *
   * A spot-only server has no positions tool, and an account with no open
   * positions is the normal case, so both answer with an empty list rather than
   * an error.
   */
  async positions(): Promise<Position[]> {
    const tool = this.map.positions;
    if (!tool) return [];

    const raw = await this.mcp.callTool(tool, {});
    const rows = pickArray(raw, ['positions', 'list', 'items'], tool);
    return rows
      .map((row) => parseTool(positionFromTool, row, tool))
      .filter((position) => position.qty !== 0);
  }

  /**
   * Sends one order and returns what the venue did with it.
   *
   * A market order is sized in quote currency, which is how the rulebook is
   * written: "spend 50 dollars", not "buy 0.0004 BTC". A limit order has no
   * quote-sized form at Binance, so the quantity is worked out from the limit
   * price and the request is rejected if no limit price came with it.
   *
   * `clientOrderId` is passed through so that re-sending the same approved
   * session is rejected by the venue as a duplicate rather than filled twice.
   *
   * @throws ExchangeShapeError if the venue's answer cannot be read.
   */
  async placeOrder(req: OrderRequest): Promise<OrderResult> {
    if (!(req.quoteUsd > 0)) {
      throw new ExchangeShapeError(this.map.placeOrder, 'the order was sized at zero dollars or less');
    }
    if (req.type === 'LIMIT' && !(req.limitPrice !== undefined && req.limitPrice > 0)) {
      throw new ExchangeShapeError(this.map.placeOrder, 'a limit order needs a limit price above zero');
    }

    const pair = this.pairFor(req.symbol);
    const args: Record<string, unknown> = {
      symbol: pair,
      side: req.side,
      type: req.type,
      clientOrderId: req.clientOrderId,
      newClientOrderId: req.clientOrderId,
    };

    if (req.type === 'MARKET') {
      args['quoteOrderQty'] = req.quoteUsd;
    } else {
      const limitPrice = req.limitPrice ?? 0;
      args['price'] = limitPrice;
      args['quantity'] = req.quoteUsd / limitPrice;
      args['timeInForce'] = 'GTC';
    }

    const raw = await this.mcp.callTool(this.map.placeOrder, args);
    return { ...parseTool(orderFromTool, raw, this.map.placeOrder), raw };
  }

  async orderStatus(symbol: string, orderId: string): Promise<OrderResult> {
    const pair = this.pairFor(symbol);
    const raw = await this.mcp.callTool(this.map.orderStatus, { symbol: pair, orderId });
    return { ...parseTool(orderFromTool, raw, this.map.orderStatus), raw };
  }

  /**
   * Accepts "BTC", "btc/usdt" or "BTCUSDT" and always returns a Binance pair.
   * The brain writes about assets, the venue trades pairs.
   */
  private pairFor(symbol: string): string {
    const cleaned = symbol.trim().toUpperCase().replace(/[/\-_]/g, '');
    if (cleaned === '') return cleaned;

    const quotes = new Set([this.quoteAsset, ...KNOWN_QUOTE_ASSETS]);
    for (const quote of quotes) {
      if (cleaned.length > quote.length && cleaned.endsWith(quote)) return cleaned;
    }
    return `${cleaned}${this.quoteAsset}`;
  }
}
