import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { AccountStateError } from '../account/state.js';
import { BazaarError } from '../bazaar/client.js';
import { RulebookInvalidError, RulebookStoreError } from '../rulebook/store.js';
import {
  SessionInputError,
  SessionNotFoundError,
  SessionNotPendingError,
} from '../session/session.js';
import { BawError } from '../x402/baw.js';

/** An error the API raises itself, already carrying the status it wants. */
export class ApiError extends Error {
  override name = 'ApiError';

  constructor(
    readonly status: ContentfulStatusCode,
    message: string,
    readonly issues?: unknown,
  ) {
    super(message);
  }
}

export interface ApiFailure {
  status: ContentfulStatusCode;
  body: Record<string, unknown>;
  /** True when the cause is worth an error line in the log rather than a warning. */
  unexpected: boolean;
}

/**
 * Turns anything thrown inside a handler into the answer the caller gets.
 *
 * The rule is that the caller learns what they did wrong and nothing else. An
 * error nobody predicted comes back as a flat 500 with no detail, because a
 * stack trace or a file path in an HTTP body is a map of the machine.
 */
export function toFailure(error: unknown): ApiFailure {
  if (error instanceof ApiError) {
    return {
      status: error.status,
      body: {
        error: error.message,
        ...(error.issues === undefined ? {} : { issues: error.issues }),
      },
      unexpected: false,
    };
  }

  if (error instanceof RulebookInvalidError) {
    return { status: 400, body: { error: error.message, issues: error.issues }, unexpected: false };
  }

  if (error instanceof SessionInputError) {
    return { status: 400, body: { error: error.message }, unexpected: false };
  }

  if (error instanceof SessionNotFoundError) {
    return { status: 404, body: { error: error.message }, unexpected: false };
  }

  if (error instanceof SessionNotPendingError) {
    return { status: 409, body: { error: error.message }, unexpected: false };
  }

  if (error instanceof AccountStateError) {
    return { status: 502, body: { error: error.message }, unexpected: false };
  }

  if (error instanceof BawError || error instanceof BazaarError) {
    return { status: 502, body: { error: error.message }, unexpected: false };
  }

  if (error instanceof RulebookStoreError) {
    return { status: 500, body: { error: error.message }, unexpected: true };
  }

  return {
    status: 500,
    body: { error: 'Olai hit a problem on its side. The detail is in the agent log.' },
    unexpected: true,
  };
}
