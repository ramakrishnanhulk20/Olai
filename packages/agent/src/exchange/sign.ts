import { createHmac } from 'node:crypto';

/**
 * Binance's signature scheme for the Spot REST API.
 *
 * A signed request carries every parameter in the query string, and the last
 * parameter is an HMAC-SHA256 of everything before it, keyed by the API secret.
 * The bytes that are signed have to be the exact bytes that are sent, so the
 * query string is built once here and handed to the caller whole. Building it
 * twice, once to sign and once to send, is the classic way to produce a
 * signature that is right for a string nobody transmitted.
 *
 * The secret is used here and nowhere else. It is never returned, logged, or
 * put in a URL as anything but the signature digest.
 */

export function signQuery(query: string, secret: string): string {
  return createHmac('sha256', secret).update(query).digest('hex');
}

export interface SignOptions {
  /** Milliseconds since the epoch, sent as Binance's timestamp parameter. */
  now: number;
  /**
   * How long Binance may sit on the request before it counts as stale. Short is
   * safer: a request captured in flight is worthless once the window passes.
   */
  recvWindowMs: number;
  secret: string;
}

/**
 * Builds the full signed query string: the caller's parameters in the order
 * they were written, then timestamp, then recvWindow, then signature.
 */
export function buildSignedQuery(
  params: Record<string, string | number | boolean>,
  opts: SignOptions,
): string {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    search.append(key, String(value));
  }
  search.append('timestamp', String(opts.now));
  search.append('recvWindow', String(opts.recvWindowMs));

  const query = search.toString();
  return `${query}&signature=${signQuery(query, opts.secret)}`;
}
