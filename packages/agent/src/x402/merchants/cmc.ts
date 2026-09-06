import { z } from 'zod';
import type { BuyRequest } from '../buyer.js';

/**
 * CoinMarketCap's paid quote endpoint, one cent a call. Symbols go on the query
 * string, comma separated for more than one, and the API expects them upper case.
 */

export const cmcQuotesLatestSchema = z.object({
  symbol: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[A-Za-z0-9]+(,[A-Za-z0-9]+)*$/, 'symbol must be a ticker, or several separated by commas')
    .transform((value) => value.toUpperCase()),
});

export function cmcQuotesLatest(p: { symbol: string }): BuyRequest {
  const { symbol } = cmcQuotesLatestSchema.parse(p);
  const url = new URL('https://pro-api.coinmarketcap.com/x402/v3/cryptocurrency/quotes/latest');
  url.searchParams.set('symbol', symbol);

  return { url: url.toString(), method: 'GET' };
}
