import { z } from 'zod';

/**
 * Every shape Olai accepts from the Binance Spot REST API.
 *
 * Binance sends money as decimal strings, not JSON numbers, because a float
 * cannot hold 0.1 exactly. Each one is parsed here, at the boundary, and
 * anything that is not a finite number stops the call. The brain downstream is
 * allowed to assume a number is a number.
 *
 * The schemas are loose objects on purpose: Binance adds fields to these
 * responses between releases, and a strict object would turn a harmless new
 * field into an outage.
 */

const numeric = z
  .union([z.number(), z.string()])
  .transform((value) => (typeof value === 'number' ? value : Number(value.trim())))
  .refine((value) => Number.isFinite(value), 'is not a number');

const level = z
  .array(z.union([z.number(), z.string()]))
  .min(2)
  .transform((entry) => [Number(entry[0]), Number(entry[1])] as [number, number])
  .refine(
    (entry) => Number.isFinite(entry[0]) && Number.isFinite(entry[1]),
    'is not a price and quantity pair',
  );

export const errorBodySchema = z.looseObject({
  code: z.number(),
  msg: z.string(),
});

export const ticker24hrSchema = z.looseObject({
  symbol: z.string().min(1),
  lastPrice: numeric,
  priceChangePercent: numeric,
  highPrice: numeric,
  lowPrice: numeric,
  quoteVolume: numeric,
  closeTime: z.number(),
});

export const depthSchema = z.looseObject({
  bids: z.array(level),
  asks: z.array(level),
});

// A kline is a positional array: open time, open, high, low, close, volume, and
// then six fields Olai does not use.
export const klinesSchema = z.array(
  z
    .array(z.union([z.number(), z.string()]))
    .min(6)
    .transform((row) => ({
      openTime: Number(row[0]),
      o: Number(row[1]),
      h: Number(row[2]),
      l: Number(row[3]),
      c: Number(row[4]),
      v: Number(row[5]),
    }))
    .refine(
      (row) => Object.values(row).every((value) => Number.isFinite(value)),
      'holds a value that is not a number',
    ),
);

export const accountSchema = z.looseObject({
  balances: z.array(
    z.looseObject({
      asset: z.string().min(1),
      free: numeric,
      locked: numeric,
    }),
  ),
});

// Asking for a symbols array, or for nothing at all, gets an array back. A
// symbol Binance does not list is simply absent from it.
export const tickerPricesSchema = z.array(
  z.looseObject({
    symbol: z.string().min(1),
    price: numeric,
  }),
);

// The three filters Olai has to respect before it sends an order. Binance
// renamed MIN_NOTIONAL to NOTIONAL and still serves both on different symbols,
// so the filter type is read as a plain string and matched by the caller.
export const exchangeInfoSchema = z.looseObject({
  symbols: z.array(
    z.looseObject({
      symbol: z.string().min(1),
      baseAsset: z.string().min(1),
      quoteAsset: z.string().min(1),
      filters: z.array(
        z.looseObject({
          filterType: z.string(),
          stepSize: numeric.optional(),
          tickSize: numeric.optional(),
          minNotional: numeric.optional(),
        }),
      ),
    }),
  ),
});

/**
 * Both the answer to POST /api/v3/order and the answer to GET /api/v3/order.
 *
 * They share every field Olai reads. The POST answer only carries the filled
 * quantities when newOrderRespType is RESULT or FULL, which is Binance's
 * default for MARKET and LIMIT, so they are required here: an order that came
 * back without them would leave the ledger recording a fill of zero on a trade
 * that really happened.
 */
export const orderSchema = z.looseObject({
  symbol: z.string().min(1),
  orderId: z.union([z.number(), z.string()]),
  clientOrderId: z.string().optional(),
  status: z.string().min(1),
  executedQty: numeric,
  cummulativeQuoteQty: numeric,
});

export type OrderBody = z.infer<typeof orderSchema>;
export type ExchangeInfoBody = z.infer<typeof exchangeInfoSchema>;
