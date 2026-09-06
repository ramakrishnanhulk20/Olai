import { createHash } from 'node:crypto';
import { LedgerError } from './types.js';

/**
 * The first line in the chain points at this instead of a real line, so the
 * chain has one fixed starting point that anyone can check.
 */
export const GENESIS_PREV_HASH = '0'.repeat(64);

/** The most a single ledger amount may be, in US dollars. */
const MAX_USD = 1_000_000_000;

/**
 * JSON with object keys in sorted order at every level.
 *
 * Two people must be able to recompute the same hash from the same line years
 * apart, so the bytes that go into the hash cannot depend on the order the keys
 * happened to be written in. Arrays keep their order because in an array the
 * order is part of the meaning.
 *
 * Throws LedgerError on anything JSON cannot carry back and forth unchanged:
 * NaN, Infinity, bigint, functions, symbols and class instances. Keys whose
 * value is undefined are dropped, which is what JSON.stringify does anyway.
 */
export function canonicalJson(value: unknown): string {
  return serialise(value, 0);
}

function serialise(value: unknown, depth: number): string {
  if (depth > 32) {
    throw new LedgerError('this payload nests deeper than 32 levels, flatten it before recording');
  }

  if (value === null) {
    return 'null';
  }

  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'string':
      return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value)) {
        throw new LedgerError(
          `a ledger payload cannot hold ${String(value)}, use a string or leave the field out`,
        );
      }
      return JSON.stringify(value);
    case 'bigint':
      throw new LedgerError('a ledger payload cannot hold a bigint, pass it as a string');
    case 'undefined':
      throw new LedgerError('a ledger payload cannot hold undefined, leave the field out instead');
    case 'function':
    case 'symbol':
      throw new LedgerError(`a ledger payload cannot hold a ${typeof value}`);
    default:
      break;
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => serialise(item, depth + 1)).join(',')}]`;
  }

  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new LedgerError(
      'a ledger payload can only hold plain objects, arrays, strings, numbers, booleans and null',
    );
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${serialise(item, depth + 1)}`)
    .join(',')}}`;
}

/** The fields of a line that the hash is taken over, in the recorded form. */
export interface HashableEntry {
  seq: number;
  ts: string;
  kind: string;
  actor: string;
  payload: Record<string, unknown>;
  costUsd?: number | undefined;
  txHash?: string | undefined;
  orderId?: string | undefined;
  sessionId?: string | undefined;
}

/**
 * sha256 over the previous line's hash followed by the canonical JSON of this
 * line. Chaining in the previous hash is what makes an edit to any old line
 * show up: every later hash stops matching.
 *
 * Missing optional fields are hashed as null so that a line written without a
 * transaction hash and the same line read back from the database produce the
 * same bytes.
 */
export function hashEntry(prevHash: string, entry: HashableEntry): string {
  const body = canonicalJson({
    seq: entry.seq,
    ts: entry.ts,
    kind: entry.kind,
    actor: entry.actor,
    payload: entry.payload,
    costUsd: entry.costUsd ?? null,
    txHash: entry.txHash ?? null,
    orderId: entry.orderId ?? null,
    sessionId: entry.sessionId ?? null,
  });

  return createHash('sha256').update(`${prevHash}${body}`, 'utf8').digest('hex');
}

/**
 * Turns a dollar amount into whole cents.
 *
 * The ledger stores money as integer cents because adding a day of $0.01 data
 * payments as floating point drifts, and a spend report that is a cent off is a
 * report nobody trusts.
 *
 * Throws LedgerError on NaN, Infinity, a negative amount, or an amount past the
 * point where cents no longer fit in a safe integer.
 */
export function usdToCents(usd: number, field: string): number {
  if (typeof usd !== 'number' || !Number.isFinite(usd)) {
    throw new LedgerError(`${field} must be a number of US dollars, got ${String(usd)}`);
  }
  if (usd < 0) {
    throw new LedgerError(`${field} cannot be negative, got ${usd}`);
  }
  if (usd > MAX_USD) {
    throw new LedgerError(`${field} is above the ${MAX_USD} dollar ceiling, got ${usd}`);
  }
  return Math.round(usd * 100);
}

export function centsToUsd(cents: number): number {
  return cents / 100;
}
