import { z } from 'zod';
import type { PricedAccept } from '../bazaar/tokens.js';

/**
 * A merchant that wants paying answers HTTP 402 with a PaymentRequired object. It
 * arrives twice: base64 in the PAYMENT-REQUIRED header and plain JSON in the body.
 * Olai reads the header first because that is the copy the x402 spec guarantees,
 * and falls back to the body when a merchant only sends one of the two.
 */

const acceptSchema = z.looseObject({
  scheme: z.string(),
  network: z.string(),
  asset: z.string(),
  payTo: z.string(),
  amount: z.string().optional(),
  maxAmountRequired: z.string().optional(),
});

const paymentRequiredSchema = z.looseObject({
  x402Version: z.number(),
  accepts: z.array(acceptSchema).default([]),
  error: z.string().nullish(),
});

export type PaymentRequiredAccept = z.infer<typeof acceptSchema>;
export type PaymentRequired = z.infer<typeof paymentRequiredSchema>;

export const PAYMENT_REQUIRED_HEADER = 'payment-required';
export const PAYMENT_RESPONSE_HEADER = 'payment-response';

function parseJsonOrNull(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function decodeBase64Json(value: string): unknown {
  const decoded = Buffer.from(value, 'base64').toString('utf8');
  return parseJsonOrNull(decoded);
}

/**
 * Turns the header value and the response body into a checked PaymentRequired.
 * Returns null when neither carries one, which the caller reports as a failure
 * rather than guessing a price.
 */
export function decodePaymentRequired(
  headerValue: string | null,
  bodyText: string,
): PaymentRequired | null {
  const candidates: unknown[] = [];

  if (headerValue) {
    candidates.push(decodeBase64Json(headerValue), parseJsonOrNull(headerValue));
  }
  if (bodyText) {
    candidates.push(parseJsonOrNull(bodyText));
  }

  for (const candidate of candidates) {
    const parsed = paymentRequiredSchema.safeParse(candidate);
    if (parsed.success) {
      return parsed.data;
    }
  }

  return null;
}

/** Settlement metadata the merchant returns after a paid call. */
export function decodeSettlement(headerValue: string | null): unknown {
  if (!headerValue) {
    return null;
  }

  return decodeBase64Json(headerValue) ?? parseJsonOrNull(headerValue);
}

/** The on-chain hash of the settled payment, when the merchant sent one. */
export function txHashFromSettlement(settlement: unknown): string | null {
  if (!settlement || typeof settlement !== 'object') {
    return null;
  }

  const record = settlement as Record<string, unknown>;
  for (const key of ['txHash', 'transaction', 'transactionHash']) {
    const value = record[key];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }

  return null;
}

/** Amounts in the shape the token table prices, whichever field name the merchant used. */
export function pricedAccepts(paymentRequired: PaymentRequired): PricedAccept[] {
  return paymentRequired.accepts.flatMap((accept) => {
    const amount = accept.amount ?? accept.maxAmountRequired;
    return amount ? [{ network: accept.network, asset: accept.asset, amount }] : [];
  });
}
