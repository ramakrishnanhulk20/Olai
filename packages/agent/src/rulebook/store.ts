import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { z } from 'zod';
import type { Ledger } from '../ledger/ledger.js';
import { type Rulebook, rulebookSchema } from '../policy/rulebook.js';

/**
 * Where the owner's rulebook lives between runs.
 *
 * Two copies are kept on purpose. The JSON file is what the agent reads when it
 * starts, and the ledger holds every version that was ever in force. The file
 * can be edited by anyone with the machine; the ledger line cannot be changed
 * without breaking the hash chain, so a rulebook that was quietly loosened is
 * always provable after the fact.
 */

/** The rulebook offered failed the schema. Carries the issues for the API. */
export class RulebookInvalidError extends Error {
  override name = 'RulebookInvalidError';

  constructor(
    message: string,
    readonly issues: z.ZodError['issues'],
  ) {
    super(message);
  }
}

/** The stored rulebook could not be read back. */
export class RulebookStoreError extends Error {
  override name = 'RulebookStoreError';
}

/**
 * What a fresh install runs under: small sizes, three liquid markets, and
 * approval required on every order, so the first thing the owner ever sees is
 * Olai asking permission rather than Olai trading.
 */
export const defaultRulebook: Rulebook = rulebookSchema.parse({
  version: 1,
  name: 'Olai starter rulebook',
  maxOrderUsd: 20,
  maxDailyLossUsd: 10,
  maxPositionUsdPerSymbol: 50,
  allowedSymbols: ['BNBUSDT', 'BTCUSDT', 'ETHUSDT'],
  allowShort: false,
  allowLeverage: false,
  maxDataSpendUsdPerDay: 1,
  maxDataSpendUsdPerCall: 0.05,
  cooldownSecondsBetweenOrders: 60,
  requireApprovalAboveUsd: 0,
  oneSidePerMarket: true,
  drawdownTiers: [
    { lossUsd: 5, action: 'halve' },
    { lossUsd: 10, action: 'halt' },
  ],
});

export class RulebookStore {
  private readonly path: string;
  private readonly ledger: Ledger;

  constructor(opts: { path: string; ledger: Ledger }) {
    if (typeof opts.path !== 'string' || opts.path.trim() === '') {
      throw new RulebookStoreError('the rulebook store needs a file path');
    }
    this.path = opts.path;
    this.ledger = opts.ledger;
  }

  /**
   * Reads the stored rulebook.
   *
   * Returns null when nothing has been saved yet, so the caller can fall back to
   * the defaults. A file that exists but does not parse throws instead: running
   * on the defaults because the owner's file got mangled would silently swap
   * their limits for someone else's.
   */
  load(): Rulebook | null {
    let text: string;
    try {
      text = readFileSync(this.path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw new RulebookStoreError(`the rulebook file could not be read: ${say(error)}`);
    }

    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new RulebookStoreError(`the rulebook file at ${this.path} is not valid JSON`);
    }

    const parsed = rulebookSchema.safeParse(raw);
    if (!parsed.success) {
      throw new RulebookStoreError(
        `the rulebook file at ${this.path} does not match the rulebook shape any more`,
      );
    }

    return parsed.data;
  }

  /**
   * Validates and stores a rulebook, then records it in the ledger.
   *
   * The file is written to a temporary name in the same directory and renamed
   * over the old one, so a crash halfway through leaves the previous rulebook
   * intact rather than half a file the agent cannot read.
   *
   * Throws RulebookInvalidError when the input fails the schema, and
   * RulebookStoreError when the file cannot be written.
   */
  save(rulebook: unknown, actor: 'owner' | 'system'): Rulebook {
    const parsed = rulebookSchema.safeParse(rulebook);
    if (!parsed.success) {
      throw new RulebookInvalidError('that rulebook is not one Olai can run', parsed.error.issues);
    }

    const book = parsed.data;
    const temp = join(dirname(this.path), `.rulebook-${randomUUID()}.tmp`);

    try {
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(temp, `${JSON.stringify(book, null, 2)}\n`, 'utf8');
      renameSync(temp, this.path);
    } catch (error) {
      rmSync(temp, { force: true });
      throw new RulebookStoreError(`the rulebook could not be saved: ${say(error)}`);
    }

    // The ledger line goes in after the file, because the file is what actually
    // governs the next order. A line claiming a rulebook that never landed on
    // disk would be worse than a rulebook that landed with the line missing.
    this.ledger.append({
      kind: 'rulebook.set',
      actor,
      payload: {
        summary: `Rulebook "${book.name}" was set by the ${actor}`,
        rulebook: book,
      },
    });

    return book;
  }
}

function say(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
