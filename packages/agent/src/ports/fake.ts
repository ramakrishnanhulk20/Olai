import type { BazaarResource } from '../bazaar/client.js';
import type { BuyOutcome, BuyRequest } from '../x402/buyer.js';
import type { DataPort } from './data.js';
import type {
  Balance,
  ExchangePort,
  Kline,
  OrderBookTop,
  OrderRequest,
  OrderResult,
  Position,
  Ticker,
} from './exchange.js';

/**
 * Stand-ins for the two outside worlds Olai touches.
 *
 * These exist for two reasons: tests that must not hit a live venue or spend
 * real money, and the dry-run demo, where the owner wants to watch the agent
 * think without a Binance connection at all.
 *
 * Both fakes are deterministic. The same inputs give the same numbers on every
 * run, so a test that fails has found a real change, not a new random price.
 */

export class FakeExchangeError extends Error {
  override name = 'FakeExchangeError';
}

const DEFAULT_PRICES: Record<string, number> = {
  BNBUSDT: 612.4,
  BTCUSDT: 84_210.5,
  ETHUSDT: 2210.9,
  SOLUSDT: 138.75,
};

const DEFAULT_BALANCES: Balance[] = [
  { asset: 'USDT', free: 1840.25, locked: 0, usdValue: 1840.25 },
  { asset: 'BNB', free: 2.5, locked: 0, usdValue: 1531 },
];

const DEFAULT_POSITIONS: Position[] = [{ symbol: 'BNBUSDT', side: 'LONG', qty: 2.5, usd: 1531 }];

const DEFAULT_AS_OF = '2026-09-06T00:00:00.000Z';

const HOUR_MS = 3_600_000;

/** A small stable hash, used only to spread the made-up numbers apart. */
function seedOf(text: string): number {
  let seed = 2_166_136_261;
  for (let i = 0; i < text.length; i += 1) {
    seed ^= text.charCodeAt(i);
    seed = Math.imul(seed, 16_777_619);
  }
  return seed >>> 0;
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

export interface FakeExchangeOptions {
  prices?: Record<string, number>;
  balances?: Balance[];
  positions?: Position[];
  asOf?: string;
  /** Force every placeOrder to come back with this status, to exercise the sad paths. */
  orderStatusOverride?: OrderResult['status'];
}

export class FakeExchange implements ExchangePort {
  readonly name = 'fake';

  /**
   * Every order this fake was asked to place, in order, including repeats.
   *
   * It deliberately does not collapse repeated client order ids the way Binance
   * does. If the fake deduplicated, a test could not tell a working idempotency
   * guard in the session runner from a broken one.
   */
  readonly orders: OrderRequest[] = [];

  private readonly results = new Map<string, OrderResult>();
  private readonly prices: Record<string, number>;
  private readonly balanceRows: Balance[];
  private readonly positionRows: Position[];
  private readonly asOf: string;
  private readonly statusOverride: OrderResult['status'] | undefined;
  private orderSeq = 0;

  constructor(options: FakeExchangeOptions = {}) {
    this.prices = options.prices ?? DEFAULT_PRICES;
    this.balanceRows = options.balances ?? DEFAULT_BALANCES;
    this.positionRows = options.positions ?? DEFAULT_POSITIONS;
    this.asOf = options.asOf ?? DEFAULT_AS_OF;
    this.statusOverride = options.orderStatusOverride;
  }

  priceOf(symbol: string): number {
    const price = this.prices[symbol];
    if (price === undefined) {
      throw new FakeExchangeError(`the fake exchange has no price for ${symbol}`);
    }
    return price;
  }

  async ticker(symbol: string): Promise<Ticker> {
    const price = this.priceOf(symbol);
    const seed = seedOf(symbol);
    return {
      symbol,
      price,
      change24hPct: round(((seed % 801) - 400) / 100, 2),
      high24h: round(price * 1.021, 4),
      low24h: round(price * 0.978, 4),
      volume24hQuote: round(price * (100_000 + (seed % 50_000)), 2),
      asOf: this.asOf,
    };
  }

  async orderBook(symbol: string, depth = 5): Promise<OrderBookTop> {
    const price = this.priceOf(symbol);
    const levels = Math.max(1, Math.min(depth, 20));
    const bids: Array<[price: number, qty: number]> = [];
    const asks: Array<[price: number, qty: number]> = [];

    for (let i = 0; i < levels; i += 1) {
      const step = (i + 1) * 0.0004;
      bids.push([round(price * (1 - step), 4), round(1.5 + i * 0.25, 4)]);
      asks.push([round(price * (1 + step), 4), round(1.4 + i * 0.3, 4)]);
    }

    return { symbol, bids, asks, asOf: this.asOf };
  }

  async klines(symbol: string, interval: string, limit = 50): Promise<Kline[]> {
    const price = this.priceOf(symbol);
    const count = Math.max(1, Math.min(limit, 500));
    let state = seedOf(`${symbol}:${interval}`);
    const start = Date.parse(this.asOf) - count * HOUR_MS;
    const out: Kline[] = [];
    let close = price * 0.97;

    for (let i = 0; i < count; i += 1) {
      state = (Math.imul(state, 1_103_515_245) + 12_345) >>> 0;
      const drift = ((state % 2001) - 1000) / 100_000;
      const open = close;
      close = round(open * (1 + drift), 4);
      out.push({
        t: new Date(start + i * HOUR_MS).toISOString(),
        o: round(open, 4),
        h: round(Math.max(open, close) * 1.002, 4),
        l: round(Math.min(open, close) * 0.998, 4),
        c: close,
        v: round(120 + (state % 900) / 10, 2),
      });
    }

    return out;
  }

  async balances(): Promise<Balance[]> {
    return this.balanceRows.map((row) => ({ ...row }));
  }

  async positions(): Promise<Position[]> {
    return this.positionRows.map((row) => ({ ...row }));
  }

  async placeOrder(req: OrderRequest): Promise<OrderResult> {
    if (!req.clientOrderId) {
      throw new FakeExchangeError('every order needs a clientOrderId');
    }
    if (!(req.quoteUsd > 0)) {
      throw new FakeExchangeError(`order size must be above zero, got ${req.quoteUsd}`);
    }
    if (req.type === 'LIMIT' && req.limitPrice === undefined) {
      throw new FakeExchangeError('a LIMIT order needs a limitPrice');
    }

    this.orders.push({ ...req });
    const fillPrice = req.type === 'LIMIT' && req.limitPrice !== undefined
      ? req.limitPrice
      : this.priceOf(req.symbol);
    this.orderSeq += 1;
    const status = this.statusOverride ?? 'FILLED';
    const filled = status === 'FILLED' || status === 'PARTIALLY_FILLED';
    const quote = status === 'PARTIALLY_FILLED' ? req.quoteUsd / 2 : req.quoteUsd;

    const result: OrderResult = {
      orderId: `fake-${this.orderSeq}`,
      status,
      executedQty: filled ? round(quote / fillPrice, 8) : 0,
      executedQuoteUsd: filled ? round(quote, 2) : 0,
      avgPrice: filled ? fillPrice : null,
      raw: { clientOrderId: req.clientOrderId, venue: this.name },
    };

    this.results.set(result.orderId, result);
    return result;
  }

  async orderStatus(_symbol: string, orderId: string): Promise<OrderResult> {
    const result = this.results.get(orderId);
    if (!result) {
      throw new FakeExchangeError(`no order ${orderId} on the fake exchange`);
    }
    return result;
  }
}

export interface FakeDataOptions {
  resources?: BazaarResource[];
  /** What each merchant URL answers with when Olai pays it. */
  outcomes?: Record<string, BuyOutcome>;
}

export class FakeData implements DataPort {
  readonly searches: Array<{ query: string; maxUsdPrice: number }> = [];
  readonly buys: Array<{ req: BuyRequest; maxUsdPerCall: number }> = [];
  private readonly resources: BazaarResource[];
  private readonly outcomes: Record<string, BuyOutcome>;

  constructor(options: FakeDataOptions = {}) {
    this.resources = options.resources ?? [];
    this.outcomes = options.outcomes ?? {};
  }

  async search(q: { query: string; maxUsdPrice: number }): Promise<BazaarResource[]> {
    this.searches.push({ ...q });
    const needle = q.query.toLowerCase();

    return this.resources.filter((resource) => {
      const matches =
        resource.url.toLowerCase().includes(needle) ||
        resource.description.toLowerCase().includes(needle);
      const affordable = resource.priceUsd !== null && resource.priceUsd <= q.maxUsdPrice;
      return matches && affordable;
    });
  }

  async buy(req: BuyRequest, maxUsdPerCall: number): Promise<BuyOutcome> {
    this.buys.push({ req: { ...req }, maxUsdPerCall });
    const outcome = this.outcomes[req.url];

    if (!outcome) {
      return { status: 'failed', reason: `the fake merchant list has nothing at ${req.url}` };
    }

    // The real buyer refuses an over-cap price before it signs, so the fake
    // refuses too. Without this a test could pass while the cap was ignored.
    const price = 'costUsd' in outcome && outcome.costUsd !== null ? outcome.costUsd : 0;
    if (price > maxUsdPerCall) {
      return {
        status: 'refused',
        reason: `merchant wants ${price} USD and the cap for this call is ${maxUsdPerCall} USD`,
        costUsd: price,
      };
    }

    return outcome;
  }
}

/** A Bazaar listing shaped like the real search results, for tests and demos. */
export function fakeResource(overrides: Partial<BazaarResource> & { url: string }): BazaarResource {
  return {
    type: 'http',
    x402Version: 2,
    description: '',
    accepts: [],
    lastUpdated: 0,
    priceUsd: 0.01,
    walletPayable: true,
    ...overrides,
  };
}
