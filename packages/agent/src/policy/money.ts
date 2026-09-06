/**
 * Every rule in the engine is decided in whole cents.
 *
 * Comparing dollars as floating point gets a rule wrong at the edge: 0.1 + 0.2
 * is not 0.3 in binary, so a $0.30 daily budget looks breached by a payment
 * that exactly fills it. Integers do not have that problem.
 */

/** The most a rulebook or an action may name, in US dollars. */
export const MAX_USD = 1_000_000_000;

/** True when the value is a real, non-negative dollar amount we can work with. */
export function isCleanUsd(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_USD;
}

/** Rounds a dollar amount to whole cents. Only call this after isCleanUsd. */
export function toCents(usd: number): number {
  return Math.round(usd * 100);
}

export function toUsd(cents: number): number {
  return cents / 100;
}

/** Money the way it reads in a sentence: 12.5 becomes "$12.50". */
export function formatUsd(usd: number): string {
  return `$${usd.toFixed(2)}`;
}
