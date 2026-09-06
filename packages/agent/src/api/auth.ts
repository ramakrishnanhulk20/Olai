import { createHash, timingSafeEqual } from 'node:crypto';
import type { Context, MiddlewareHandler } from 'hono';
import { log } from './log.js';

/**
 * The front door.
 *
 * There is exactly one user, the owner, and one token. The token lives in its
 * own namespace so it can never be mistaken for, or guessed from, a session id
 * or any other identifier the API hands out.
 */

/** Owner tokens start with this and nothing else does. */
export const OWNER_TOKEN_PREFIX = 'ol.';

/** Short enough to paste, long enough that guessing is not worth trying. */
const MIN_TOKEN_LENGTH = 24;

export const RATE_LIMIT_MAX = 60;
export const RATE_LIMIT_WINDOW_MS = 60_000;

/** Fails at boot rather than serving a door with a weak lock on it. */
export function assertOwnerToken(token: unknown): asserts token is string {
  if (typeof token !== 'string' || !token.startsWith(OWNER_TOKEN_PREFIX)) {
    throw new Error(`the owner token has to start with ${OWNER_TOKEN_PREFIX}`);
  }
  if (token.length < MIN_TOKEN_LENGTH) {
    throw new Error(`the owner token has to be at least ${MIN_TOKEN_LENGTH} characters`);
  }
}

/**
 * Where the request came from, for the log and for the rate limit.
 *
 * X-Forwarded-For is a header, and a header is whatever the caller typed, so a
 * limit counted on it is a limit anyone can walk around by changing a string.
 * It is only read when the deployment says it sits behind a proxy that
 * overwrites it.
 */
export function clientIp(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
    if (forwarded) {
      return forwarded;
    }
  }

  const env = c.env as { incoming?: { socket?: { remoteAddress?: string | null } } } | undefined;
  return env?.incoming?.socket?.remoteAddress ?? 'local';
}

/**
 * Compares two tokens without letting the clock tell an attacker how close they
 * got. Both sides are hashed first so that tokens of different lengths still
 * take the same time; timingSafeEqual needs two buffers of equal size, and the
 * length of the real token is itself a hint worth not giving away.
 */
function sameToken(given: string, expected: string): boolean {
  const a = createHash('sha256').update(given, 'utf8').digest();
  const b = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(a, b);
}

export function ownerAuth(opts: { token: string; trustProxy: boolean }): MiddlewareHandler {
  return async (c, next) => {
    const header = c.req.header('authorization') ?? '';
    const match = /^Bearer\s+(.+)$/i.exec(header);

    if (!match?.[1] || !sameToken(match[1], opts.token)) {
      log.warn(
        {
          ip: clientIp(c, opts.trustProxy),
          method: c.req.method,
          path: c.req.path,
          reason: match?.[1] ? 'wrong token' : 'no bearer token',
        },
        'refused a request to the owner API',
      );
      return c.json({ error: 'this API belongs to one owner and that token is not theirs' }, 401);
    }

    await next();
    return;
  };
}

interface Window {
  count: number;
  resetAt: number;
}

/** Above this many tracked addresses, expired windows are swept before use. */
const SWEEP_ABOVE = 1024;

/**
 * A fixed window per address. Counting on the address rather than on anything
 * the caller sends means the only way to get more requests is to have more
 * machines.
 */
export function rateLimit(opts: {
  trustProxy: boolean;
  max?: number;
  windowMs?: number;
  now?: () => number;
}): MiddlewareHandler {
  const max = opts.max ?? RATE_LIMIT_MAX;
  const windowMs = opts.windowMs ?? RATE_LIMIT_WINDOW_MS;
  const clock = opts.now ?? Date.now;
  const windows = new Map<string, Window>();

  return async (c, next) => {
    const now = clock();

    if (windows.size > SWEEP_ABOVE) {
      for (const [key, window] of windows) {
        if (window.resetAt <= now) {
          windows.delete(key);
        }
      }
    }

    const ip = clientIp(c, opts.trustProxy);
    const current = windows.get(ip);

    if (!current || current.resetAt <= now) {
      windows.set(ip, { count: 1, resetAt: now + windowMs });
      await next();
      return;
    }

    current.count += 1;

    if (current.count > max) {
      const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
      log.warn(
        { ip, method: c.req.method, path: c.req.path, count: current.count },
        'rate limited a caller on the owner API',
      );
      c.header('Retry-After', String(retryAfter));
      return c.json(
        { error: `too many requests, wait ${retryAfter} seconds`, retryAfterSeconds: retryAfter },
        429,
      );
    }

    await next();
    return;
  };
}
