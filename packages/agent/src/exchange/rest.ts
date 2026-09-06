import { pino } from 'pino';
import type { z } from 'zod';
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
import { ExchangeApiError, ExchangeRateLimitError } from './errors.js';
import {
  accountSchema,
  depthSchema,
  errorBodySchema,
  exchangeInfoSchema,
  klinesSchema,
  type OrderBody,
  orderSchema,
  ticker24hrSchema,
  tickerPricesSchema,
} from './schemas.js';
import { buildSignedQuery } from './sign.js';

/**
 * Olai's exchange leg, spoken directly to Binance's Spot REST API with an API
 * key on an isolated sub-account.
 *
 * The hosted MCP server is the nicer door, but its consent screen only admits
 * Binance's own allowlisted agents today, so this is the door Olai can actually
 * walk through. Same port, same types, same brain above it.
 *
 * Two rules run through the whole file. The secret only ever appears as an HMAC
 * digest, never in a log line and never as a URL parameter. And a POST that
 * places an order is never retried: if the answer is lost, Olai asks Binance
 * what happened by the client order id instead of sending a second order.
 */

const log = pino({
  name: 'olai.exchange',
  level: process.env.OLAI_LOG_LEVEL ?? (process.env.VITEST ? 'silent' : 'info'),
});

/** Dollar-pegged assets Olai counts at face value rather than pricing. */
const FACE_VALUE_ASSETS = new Set(['USDT', 'USDC', 'FDUSD', 'USD1']);

/**
 * How many symbols go in one ticker/price request. Binance takes a JSON array
 * of up to 100 symbols in a single call, which is how a wallet full of coins
 * gets priced without spending the minute's weight budget one coin at a time.
 */
const MAX_SYMBOLS_PER_PRICE_CALL = 100;

/** A holding worth less than this is dust from a fill, not a position. */
const POSITION_DUST_USD = 1;

/** Depth sizes Binance accepts. Anything else comes back as a -1100 error. */
const DEPTH_STEPS = [5, 10, 20, 50, 100, 500, 1000, 5000];

const DEFAULT_RECV_WINDOW_MS = 5_000;

export interface RestExchangeOptions {
  baseUrl: string;
  apiKey: string;
  apiSecret: string;
  fetch?: typeof fetch;
  now?: () => number;
  recvWindowMs?: number;
  quoteAsset?: string;
}

interface SymbolRules {
  stepSize: number | null;
  tickSize: number | null;
  minNotional: number | null;
}

interface RequestOptions<T> {
  method: 'GET' | 'POST';
  path: string;
  params?: Record<string, string | number | boolean>;
  signed?: boolean;
  schema: z.ZodType<T>;
  /** Only placeOrder sets this: what to do when the request never got an answer. */
  recover?: (error: unknown) => Promise<T>;
}

export class BinanceRestExchange implements ExchangePort {
  readonly name: string;

  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly recvWindowMs: number;
  private readonly quoteAsset: string;
  private readonly rules = new Map<string, Promise<SymbolRules>>();

  constructor(opts: RestExchangeOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.apiKey = opts.apiKey;
    this.apiSecret = opts.apiSecret;
    this.fetchImpl = opts.fetch ?? fetch;
    this.now = opts.now ?? Date.now;
    this.recvWindowMs = opts.recvWindowMs ?? DEFAULT_RECV_WINDOW_MS;
    this.quoteAsset = opts.quoteAsset ?? 'USDT';
    this.name =
      this.baseUrl === 'https://api.binance.com'
        ? 'binance-spot'
        : this.baseUrl === 'https://testnet.binance.vision'
          ? 'binance-spot-testnet'
          : 'binance-spot-custom';

    log.info(
      { exchange: this.name, baseUrl: this.baseUrl, apiKey: maskKey(this.apiKey) },
      `Olai will trade through ${this.name}`,
    );
  }

  async ticker(symbol: string): Promise<Ticker> {
    const body = await this.request({
      method: 'GET',
      path: '/api/v3/ticker/24hr',
      params: { symbol },
      schema: ticker24hrSchema,
    });

    return {
      symbol: body.symbol,
      price: body.lastPrice,
      change24hPct: body.priceChangePercent,
      high24h: body.highPrice,
      low24h: body.lowPrice,
      volume24hQuote: body.quoteVolume,
      asOf: new Date(body.closeTime).toISOString(),
    };
  }

  async orderBook(symbol: string, depth = 10): Promise<OrderBookTop> {
    const wanted = Math.max(1, Math.floor(depth));
    const body = await this.request({
      method: 'GET',
      path: '/api/v3/depth',
      params: { symbol, limit: DEPTH_STEPS.find((step) => step >= wanted) ?? 5000 },
      schema: depthSchema,
    });

    return {
      symbol,
      bids: body.bids.slice(0, wanted),
      asks: body.asks.slice(0, wanted),
      // The order book carries no timestamp of its own, so the honest answer is
      // when Olai read it, not a made-up exchange time.
      asOf: new Date(this.now()).toISOString(),
    };
  }

  async klines(symbol: string, interval: string, limit = 100): Promise<Kline[]> {
    const rows = await this.request({
      method: 'GET',
      path: '/api/v3/klines',
      params: { symbol, interval, limit },
      schema: klinesSchema,
    });

    return rows.map((row) => ({
      t: new Date(row.openTime).toISOString(),
      o: row.o,
      h: row.h,
      l: row.l,
      c: row.c,
      v: row.v,
    }));
  }

  async balances(): Promise<Balance[]> {
    return (await this.balancesDetailed()).balances;
  }

  /**
   * The same balances, plus the assets Binance would not put a price on.
   *
   * An unpriced holding is left at usdValue null rather than guessed at, and
   * naming it here is what lets the caller say so out loud instead of quietly
   * treating the owner's coin as if it were not there.
   */
  async balancesDetailed(): Promise<{ balances: Balance[]; unpricedAssets: string[] }> {
    const account = await this.request({
      method: 'GET',
      path: '/api/v3/account',
      signed: true,
      schema: accountSchema,
    });

    // A dollar asset and an empty balance both have a known value, so only what
    // is left needs a price, and all of it is asked for in one go.
    const needPricing = account.balances.filter(
      (row) => !FACE_VALUE_ASSETS.has(row.asset) && row.free + row.locked !== 0,
    );
    const prices = await this.pricesOf(
      needPricing.map((row) => `${row.asset}${this.quoteAsset}`),
    );

    const balances: Balance[] = [];
    const unpricedAssets: string[] = [];

    for (const row of account.balances) {
      const total = row.free + row.locked;

      if (FACE_VALUE_ASSETS.has(row.asset)) {
        balances.push({ asset: row.asset, free: row.free, locked: row.locked, usdValue: total });
        continue;
      }

      if (total === 0) {
        balances.push({ asset: row.asset, free: row.free, locked: row.locked, usdValue: 0 });
        continue;
      }

      const price = prices.get(`${row.asset}${this.quoteAsset}`);
      if (price === undefined) {
        unpricedAssets.push(row.asset);
        balances.push({ asset: row.asset, free: row.free, locked: row.locked, usdValue: null });
        continue;
      }

      balances.push({
        asset: row.asset,
        free: row.free,
        locked: row.locked,
        usdValue: total * price,
      });
    }

    if (unpricedAssets.length > 0) {
      log.warn(
        { assets: unpricedAssets },
        'Binance priced none of these assets, so they are left out of the account value',
      );
    }

    return { balances, unpricedAssets };
  }

  async positions(): Promise<Position[]> {
    const held = await this.balances();

    // Spot has no positions in the futures sense. What the owner means by a
    // position is simply a coin they are holding, so a whole dollar counts and
    // anything under that is dust from a fill.
    return held
      .filter(
        (row) => !FACE_VALUE_ASSETS.has(row.asset) && (row.usdValue ?? 0) >= POSITION_DUST_USD,
      )
      .map((row) => ({
        symbol: `${row.asset}${this.quoteAsset}`,
        side: 'LONG' as const,
        qty: row.free + row.locked,
        usd: row.usdValue as number,
      }));
  }

  async placeOrder(req: OrderRequest): Promise<OrderResult> {
    if (!req.clientOrderId) {
      throw new ExchangeApiError('every order needs a clientOrderId', 0, null, '');
    }
    if (!(req.quoteUsd > 0)) {
      throw new ExchangeApiError(`order size must be above zero, got ${req.quoteUsd}`, 0, null, '');
    }

    const rules = await this.rulesFor(req.symbol);

    if (rules.minNotional !== null && req.quoteUsd < rules.minNotional) {
      throw new ExchangeApiError(
        `${req.symbol} will not take an order under ${rules.minNotional} ${this.quoteAsset}, and this one is ${req.quoteUsd}`,
        0,
        null,
        '',
      );
    }

    const params: Record<string, string | number> = {
      symbol: req.symbol,
      side: req.side,
      type: req.type,
    };

    if (req.type === 'MARKET') {
      params['quoteOrderQty'] = trim(req.quoteUsd, 8);
    } else {
      if (req.limitPrice === undefined || !(req.limitPrice > 0)) {
        throw new ExchangeApiError('a LIMIT order needs a limitPrice above zero', 0, null, '');
      }

      // Rounded down, never up: rounding a price or a size up would spend more
      // of the owner's money than the rulebook approved.
      const price = roundDownTo(req.limitPrice, rules.tickSize);
      const quantity = roundDownTo(req.quoteUsd / price, rules.stepSize);

      if (!(price > 0) || !(quantity > 0)) {
        throw new ExchangeApiError(
          `${req.quoteUsd} ${this.quoteAsset} of ${req.symbol} at ${req.limitPrice} rounds down to nothing tradable`,
          0,
          null,
          '',
        );
      }

      params['timeInForce'] = 'GTC';
      params['quantity'] = trim(quantity, decimalsOf(rules.stepSize) ?? 8);
      params['price'] = trim(price, decimalsOf(rules.tickSize) ?? 8);
    }

    params['newClientOrderId'] = req.clientOrderId;

    log.info(
      {
        symbol: req.symbol,
        side: req.side,
        type: req.type,
        quoteUsd: req.quoteUsd,
        clientOrderId: req.clientOrderId,
      },
      `sending ${req.side} ${req.type} ${req.quoteUsd} ${this.quoteAsset} of ${req.symbol}`,
    );

    const body = await this.request({
      method: 'POST',
      path: '/api/v3/order',
      params,
      signed: true,
      schema: orderSchema,
      // A lost answer is not a lost order. Binance may well have taken it, so
      // Olai asks by the client order id rather than sending a second one.
      recover: async (error) => {
        log.warn(
          { symbol: req.symbol, clientOrderId: req.clientOrderId, reason: say(error) },
          'the order request got no answer, asking Binance what happened before anything else',
        );
        return this.fetchOrder(req.symbol, req.clientOrderId, error);
      },
    });

    const result = toOrderResult(body);
    log.info(
      {
        symbol: req.symbol,
        orderId: result.orderId,
        status: result.status,
        executedQuoteUsd: result.executedQuoteUsd,
      },
      `order ${result.orderId} came back ${result.status}`,
    );
    return result;
  }

  /**
   * Looks one order up again.
   *
   * The id is the client order id Olai sent, which is the session id, because
   * that is the id Olai chose and can reproduce after a crash. Binance's own
   * numeric order id is in OrderResult.orderId for the ledger.
   */
  async orderStatus(symbol: string, orderId: string): Promise<OrderResult> {
    const body = await this.request({
      method: 'GET',
      path: '/api/v3/order',
      params: { symbol, origClientOrderId: orderId },
      signed: true,
      schema: orderSchema,
    });

    return toOrderResult(body);
  }

  /**
   * The lot size, tick size and minimum order value for one symbol.
   *
   * Cached for the life of the instance because Binance changes these a few
   * times a year, and looking them up before every order would double the
   * request count on the hottest path.
   */
  private rulesFor(symbol: string): Promise<SymbolRules> {
    const cached = this.rules.get(symbol);
    if (cached) {
      return cached;
    }

    const pending = this.loadRules(symbol).catch((error: unknown) => {
      // A failed lookup must not be remembered, or one bad minute would block
      // every order on this symbol until the process restarts.
      this.rules.delete(symbol);
      throw error;
    });

    this.rules.set(symbol, pending);
    return pending;
  }

  private async loadRules(symbol: string): Promise<SymbolRules> {
    const info = await this.request({
      method: 'GET',
      path: '/api/v3/exchangeInfo',
      params: { symbol },
      schema: exchangeInfoSchema,
    });

    const found = info.symbols.find((entry) => entry.symbol === symbol);
    if (!found) {
      throw new ExchangeApiError(`Binance does not list the symbol ${symbol}`, 0, null, '');
    }

    const filterOf = (type: string) => found.filters.find((filter) => filter.filterType === type);

    return {
      stepSize: filterOf('LOT_SIZE')?.stepSize ?? null,
      tickSize: filterOf('PRICE_FILTER')?.tickSize ?? null,
      // Binance renamed MIN_NOTIONAL to NOTIONAL and still serves the old name
      // on some symbols, so both are read and whichever exists wins.
      minNotional:
        filterOf('NOTIONAL')?.minNotional ?? filterOf('MIN_NOTIONAL')?.minNotional ?? null,
    };
  }

  /**
   * Prices many symbols at once. A symbol Binance does not list is simply
   * missing from the answer, which the caller reads as no price rather than as
   * a failure: one unlisted coin must not stop the whole account being read.
   *
   * Binance rejects the entire batch with an invalid symbol error if even one
   * pair does not exist, so that case falls back to one request for the whole
   * market. That is two requests at worst, never one per coin.
   */
  private async pricesOf(symbols: string[]): Promise<Map<string, number>> {
    const prices = new Map<string, number>();
    const wanted = new Set(symbols);

    const keep = (rows: Array<{ symbol: string; price: number }>): void => {
      for (const row of rows) {
        if (wanted.has(row.symbol)) {
          prices.set(row.symbol, row.price);
        }
      }
    };

    for (let from = 0; from < symbols.length; from += MAX_SYMBOLS_PER_PRICE_CALL) {
      const chunk = symbols.slice(from, from + MAX_SYMBOLS_PER_PRICE_CALL);

      try {
        keep(
          await this.request({
            method: 'GET',
            path: '/api/v3/ticker/price',
            params: { symbols: JSON.stringify(chunk) },
            schema: tickerPricesSchema,
          }),
        );
      } catch (error) {
        if (error instanceof ExchangeRateLimitError || !(error instanceof ExchangeApiError)) {
          throw error;
        }
        // The whole market answers every symbol still wanted, so there is
        // nothing left for the remaining chunks to ask about.
        keep(await this.wholeMarketPrices());
        return prices;
      }
    }

    return prices;
  }

  /** Every symbol Binance lists, in one request. Empty when even that fails. */
  private async wholeMarketPrices(): Promise<Array<{ symbol: string; price: number }>> {
    try {
      return await this.request({
        method: 'GET',
        path: '/api/v3/ticker/price',
        schema: tickerPricesSchema,
      });
    } catch (error) {
      if (error instanceof ExchangeRateLimitError || !(error instanceof ExchangeApiError)) {
        throw error;
      }
      return [];
    }
  }

  /** Used once, and only after an order request went unanswered. */
  private async fetchOrder(
    symbol: string,
    clientOrderId: string,
    cause: unknown,
  ): Promise<OrderBody> {
    try {
      const body = await this.request({
        method: 'GET',
        path: '/api/v3/order',
        params: { symbol, origClientOrderId: clientOrderId },
        signed: true,
        schema: orderSchema,
      });
      log.warn(
        { symbol, clientOrderId, status: body.status },
        'the order did reach Binance, so no second order was sent',
      );
      return body;
    } catch {
      throw cause;
    }
  }

  private async request<T>(opts: RequestOptions<T>): Promise<T> {
    const params = opts.params ?? {};
    const query = opts.signed
      ? buildSignedQuery(params, {
          now: this.now(),
          recvWindowMs: this.recvWindowMs,
          secret: this.apiSecret,
        })
      : new URLSearchParams(
          Object.entries(params).map(([key, value]) => [key, String(value)]),
        ).toString();

    const url =
      query === '' ? `${this.baseUrl}${opts.path}` : `${this.baseUrl}${opts.path}?${query}`;
    const headers: Record<string, string> = { accept: 'application/json' };
    if (opts.signed) {
      headers['X-MBX-APIKEY'] = this.apiKey;
    }

    let response: Response;
    try {
      response = await this.fetchImpl(url, { method: opts.method, headers });
    } catch (error) {
      if (opts.recover) {
        return opts.recover(error);
      }
      throw error;
    }

    const text = await response.text();

    if (!response.ok) {
      throw failureFrom(response, text, opts.path);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new ExchangeApiError(
        `Binance answered ${opts.path} with something that is not JSON`,
        response.status,
        null,
        text.slice(0, 200),
      );
    }

    const result = opts.schema.safeParse(parsed);
    if (!result.success) {
      const detail = result.error.issues
        .map((issue) => `${issue.path.join('.') || 'value'} ${issue.message}`)
        .join('; ');
      throw new ExchangeApiError(
        `Binance answered ${opts.path} in a shape Olai cannot read: ${detail}`,
        response.status,
        null,
        '',
      );
    }

    return result.data;
  }
}

function toOrderResult(body: OrderBody): OrderResult {
  return {
    orderId: String(body.orderId),
    status: statusFrom(body.status),
    executedQty: body.executedQty,
    executedQuoteUsd: body.cummulativeQuoteQty,
    avgPrice: body.executedQty > 0 ? body.cummulativeQuoteQty / body.executedQty : null,
    raw: body,
  };
}

const STATUS_BY_BINANCE_WORD: Record<string, OrderResult['status']> = {
  NEW: 'NEW',
  PENDING_NEW: 'NEW',
  PARTIALLY_FILLED: 'PARTIALLY_FILLED',
  FILLED: 'FILLED',
  REJECTED: 'REJECTED',
  CANCELED: 'CANCELED',
  PENDING_CANCEL: 'CANCELED',
  // An expired order will never fill and holds no money, so it is dead in the
  // same way a cancelled one is.
  EXPIRED: 'CANCELED',
  EXPIRED_IN_MATCH: 'CANCELED',
};

function statusFrom(word: string): OrderResult['status'] {
  const known = STATUS_BY_BINANCE_WORD[word.toUpperCase()];
  if (!known) {
    throw new ExchangeApiError(
      `Binance reported an order status Olai does not know: ${word}`,
      0,
      null,
      word,
    );
  }
  return known;
}

function failureFrom(response: Response, text: string, path: string): ExchangeApiError {
  let code: number | null = null;
  let msg = text.slice(0, 200);

  try {
    const body = errorBodySchema.safeParse(JSON.parse(text));
    if (body.success) {
      code = body.data.code;
      msg = body.data.msg;
    }
  } catch {
    // A non-JSON body is normal for a gateway error page. The text is kept as is.
  }

  const summary = `Binance refused ${path} with HTTP ${response.status}${code === null ? '' : ` (code ${code})`}: ${msg}`;

  // 429 is the warning and 418 is the ban that follows ignoring it. Both mean
  // stop asking, which is a different problem from a bad request.
  if (response.status === 429 || response.status === 418) {
    const header = response.headers.get('retry-after');
    const seconds = header === null ? Number.NaN : Number(header);
    return new ExchangeRateLimitError(
      summary,
      response.status,
      code,
      msg,
      Number.isFinite(seconds) ? seconds : null,
    );
  }

  return new ExchangeApiError(summary, response.status, code, msg);
}

/** How many decimal places a filter step has, so a size can be printed exactly. */
function decimalsOf(step: number | null): number | null {
  if (step === null || !(step > 0)) {
    return null;
  }

  const text = step.toExponential();
  const exponent = Number(text.slice(text.indexOf('e') + 1));
  const mantissa = text.slice(0, text.indexOf('e'));
  const mantissaDecimals = mantissa.includes('.') ? mantissa.length - mantissa.indexOf('.') - 1 : 0;
  return Math.max(0, mantissaDecimals - exponent);
}

/**
 * Rounds down to a whole number of filter steps.
 *
 * The arithmetic is done in whole units at the step's own precision, because
 * doing it in floats gives quantities like 0.30000000000000004 and Binance
 * rejects those with a LOT_SIZE error the owner can do nothing about.
 */
function roundDownTo(value: number, step: number | null): number {
  const decimals = decimalsOf(step);
  if (step === null || decimals === null) {
    return value;
  }

  const scale = 10 ** decimals;
  const stepUnits = Math.round(step * scale);
  // The nudge absorbs float dust from the division above. It is many orders of
  // magnitude smaller than one unit at this precision.
  const valueUnits = Math.floor(value * scale + 1e-6);
  return (Math.floor(valueUnits / stepUnits) * stepUnits) / scale;
}

/** A plain decimal string, never exponent notation, which Binance rejects. */
function trim(value: number, decimals: number): string {
  const fixed = value.toFixed(Math.min(decimals, 8));
  return fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed;
}

/** Enough of the key to tell two of them apart, never enough to use one. */
function maskKey(key: string): string {
  return key.length <= 8 ? '********' : `${key.slice(0, 4)}...${key.slice(-4)}`;
}

function say(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
