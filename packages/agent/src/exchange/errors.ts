/**
 * What Binance says when it refuses, in a shape Olai can act on.
 *
 * Binance answers a bad request with an HTTP status and a small JSON body
 * carrying its own numeric code, and the two say different things: -2010 with a
 * 400 is "your order was rejected", -1021 with a 400 is "your clock is off".
 * Keeping both apart from the message means a caller can branch on the code
 * instead of matching English text that Binance is free to change.
 */

export class ExchangeApiError extends Error {
  override name = 'ExchangeApiError';

  constructor(
    message: string,
    /** 0 when Olai refused the call itself and never reached Binance. */
    readonly httpStatus: number,
    /** Binance's own error code, null when the refusal is Olai's own. */
    readonly code: number | null,
    readonly binanceMessage: string,
  ) {
    super(message);
  }
}

/**
 * A 429 (too many requests) or a 418 (banned for ignoring a 429).
 *
 * Held apart from the plain API error because it is the one failure where the
 * right answer is to wait rather than to change the request. Nothing in Olai
 * retries automatically; the caller decides, and retryAfterSeconds tells it how
 * long Binance wants to be left alone.
 */
export class ExchangeRateLimitError extends ExchangeApiError {
  override name = 'ExchangeRateLimitError';

  constructor(
    message: string,
    httpStatus: number,
    code: number | null,
    binanceMessage: string,
    readonly retryAfterSeconds: number | null,
  ) {
    super(message, httpStatus, code, binanceMessage);
  }
}
