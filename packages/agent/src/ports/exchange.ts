/**
 * The exchange door. Everything Olai reads from or sends to a market goes
 * through this one interface, so the brain never learns whether it is talking
 * to the Binance MCP server or to a fake in a test.
 *
 * Money units are deliberately quote-denominated (USD) rather than base
 * quantities: the owner writes rules in dollars, so orders are sized in dollars
 * and the venue works out the quantity.
 */

export interface Ticker {
  symbol: string;
  price: number;
  change24hPct: number;
  high24h: number;
  low24h: number;
  volume24hQuote: number;
  asOf: string;
}

export interface OrderBookTop {
  symbol: string;
  bids: Array<[price: number, qty: number]>;
  asks: Array<[price: number, qty: number]>;
  asOf: string;
}

export interface Balance {
  asset: string;
  free: number;
  locked: number;
  usdValue: number | null;
}

export interface Position {
  symbol: string;
  side: 'LONG' | 'SHORT';
  qty: number;
  usd: number;
}

export interface Kline {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface OrderRequest {
  symbol: string;
  side: 'BUY' | 'SELL';
  type: 'MARKET' | 'LIMIT';
  quoteUsd: number;
  limitPrice?: number;
  /**
   * The caller's own id for this order. Olai sends the session id, which is
   * what makes a repeated approval a no-op at the venue as well as here.
   */
  clientOrderId: string;
}

export interface OrderResult {
  orderId: string;
  status: 'FILLED' | 'PARTIALLY_FILLED' | 'NEW' | 'REJECTED' | 'CANCELED';
  executedQty: number;
  executedQuoteUsd: number;
  avgPrice: number | null;
  raw: unknown;
}

export interface ExchangePort {
  name: string;
  ticker(symbol: string): Promise<Ticker>;
  orderBook(symbol: string, depth?: number): Promise<OrderBookTop>;
  klines(symbol: string, interval: string, limit?: number): Promise<Kline[]>;
  balances(): Promise<Balance[]>;
  positions(): Promise<Position[]>;
  placeOrder(req: OrderRequest): Promise<OrderResult>;
  orderStatus(symbol: string, orderId: string): Promise<OrderResult>;
}
