import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { GENESIS_PREV_HASH, canonicalJson, centsToUsd, hashEntry, usdToCents } from './hash.js';
import {
  type LedgerActor,
  type LedgerEntry,
  type LedgerEntryInput,
  type LedgerKind,
  LedgerError,
  ledgerActors,
  ledgerKinds,
} from './types.js';

interface LedgerRow {
  seq: number;
  ts: string;
  kind: string;
  actor: string;
  payload: string;
  cost_cents: number | null;
  tx_hash: string | null;
  order_id: string | null;
  session_id: string | null;
  prev_hash: string;
  hash: string;
}

export interface ListOptions {
  afterSeq?: number;
  limit?: number;
  kinds?: LedgerKind[];
  sessionId?: string;
}

export type ChainCheck = { ok: true; length: number } | { ok: false; brokenAtSeq: number; reason: string };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS ledger (
  seq        INTEGER PRIMARY KEY,
  ts         TEXT    NOT NULL,
  kind       TEXT    NOT NULL,
  actor      TEXT    NOT NULL,
  payload    TEXT    NOT NULL,
  cost_cents INTEGER,
  tx_hash    TEXT,
  order_id   TEXT,
  session_id TEXT,
  prev_hash  TEXT    NOT NULL,
  hash       TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS ledger_ts ON ledger (ts);
CREATE INDEX IF NOT EXISTS ledger_session ON ledger (session_id);

CREATE TRIGGER IF NOT EXISTS ledger_no_update BEFORE UPDATE ON ledger
BEGIN
  SELECT RAISE(ABORT, 'the ledger is append only, a line cannot be changed');
END;

CREATE TRIGGER IF NOT EXISTS ledger_no_delete BEFORE DELETE ON ledger
BEGIN
  SELECT RAISE(ABORT, 'the ledger is append only, a line cannot be removed');
END;
`;

const kindSet = new Set<string>(ledgerKinds);
const actorSet = new Set<string>(ledgerActors);

/**
 * Olai's audit ledger: one SQLite file, one table, append only, hash chained.
 *
 * Every decision Olai makes lands here as a numbered line that points at the
 * line before it. Changing an old line changes its hash, so every later line
 * stops matching and verifyChain names the first line that broke. The database
 * itself refuses UPDATE and DELETE through triggers, so tampering means going
 * around the database on purpose, which is exactly what we want an auditor to
 * be able to detect.
 */
export class Ledger {
  private readonly db: Database.Database;
  private readonly insert: Database.Statement;
  private closed = false;

  /**
   * Opens or creates the ledger file. The parent directory is created if it is
   * missing. Pass ':memory:' for a throwaway ledger that lives in RAM.
   */
  constructor(dbPath: string) {
    if (typeof dbPath !== 'string' || dbPath.trim() === '') {
      throw new LedgerError('the ledger needs a file path, or the string :memory:');
    }

    if (dbPath !== ':memory:') {
      mkdirSync(dirname(dbPath), { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = FULL');
    this.db.pragma('busy_timeout = 5000');
    this.db.exec(SCHEMA);

    this.insert = this.db.prepare(
      `INSERT INTO ledger (seq, ts, kind, actor, payload, cost_cents, tx_hash, order_id, session_id, prev_hash, hash)
       VALUES (@seq, @ts, @kind, @actor, @payload, @cost_cents, @tx_hash, @order_id, @session_id, @prev_hash, @hash)`,
    );
  }

  /**
   * Records one line and returns it as written, including the sequence number,
   * the timestamp and the hash.
   *
   * The timestamp is set here, never by the caller, so nobody can backdate a
   * line. The whole read-then-write runs in one immediate transaction so two
   * writers cannot both claim the same sequence number.
   *
   * Throws LedgerError on an unknown kind or actor, a payload that is not a
   * plain object, or a cost that is not a real non-negative dollar amount.
   */
  append(input: LedgerEntryInput): LedgerEntry {
    this.assertOpen();
    const checked = this.check(input);
    const ts = new Date().toISOString();

    const write = this.db.transaction((): LedgerEntry => {
      const previous = this.db
        .prepare('SELECT seq, hash FROM ledger ORDER BY seq DESC LIMIT 1')
        .get() as Pick<LedgerRow, 'seq' | 'hash'> | undefined;

      const seq = previous ? previous.seq + 1 : 1;
      const prevHash = previous ? previous.hash : GENESIS_PREV_HASH;

      const entry: LedgerEntry = {
        seq,
        ts,
        kind: checked.kind,
        actor: checked.actor,
        payload: checked.payload,
        ...(checked.costUsd === undefined ? {} : { costUsd: checked.costUsd }),
        ...(checked.txHash === undefined ? {} : { txHash: checked.txHash }),
        ...(checked.orderId === undefined ? {} : { orderId: checked.orderId }),
        ...(checked.sessionId === undefined ? {} : { sessionId: checked.sessionId }),
        prevHash,
        hash: '',
      };
      entry.hash = hashEntry(prevHash, entry);

      this.insert.run({
        seq,
        ts,
        kind: entry.kind,
        actor: entry.actor,
        payload: checked.payloadJson,
        cost_cents: checked.costCents,
        tx_hash: entry.txHash ?? null,
        order_id: entry.orderId ?? null,
        session_id: entry.sessionId ?? null,
        prev_hash: prevHash,
        hash: entry.hash,
      });

      return entry;
    });

    return write.immediate();
  }

  /**
   * Reads lines in sequence order, oldest first.
   *
   * With no options it returns the whole ledger. afterSeq pages forward,
   * kinds and sessionId narrow the result. An empty kinds array means nothing
   * matches, which is different from leaving kinds out.
   */
  list(opts: ListOptions = {}): LedgerEntry[] {
    this.assertOpen();

    const where: string[] = [];
    const params: Array<string | number> = [];

    if (opts.afterSeq !== undefined) {
      if (!Number.isInteger(opts.afterSeq) || opts.afterSeq < 0) {
        throw new LedgerError('afterSeq must be a whole number of zero or more');
      }
      where.push('seq > ?');
      params.push(opts.afterSeq);
    }

    if (opts.sessionId !== undefined) {
      where.push('session_id = ?');
      params.push(opts.sessionId);
    }

    if (opts.kinds !== undefined) {
      if (opts.kinds.length === 0) {
        return [];
      }
      where.push(`kind IN (${opts.kinds.map(() => '?').join(',')})`);
      params.push(...opts.kinds);
    }

    let sql = 'SELECT * FROM ledger';
    if (where.length > 0) {
      sql += ` WHERE ${where.join(' AND ')}`;
    }
    sql += ' ORDER BY seq ASC';

    if (opts.limit !== undefined) {
      if (!Number.isInteger(opts.limit) || opts.limit < 0) {
        throw new LedgerError('limit must be a whole number of zero or more');
      }
      sql += ' LIMIT ?';
      params.push(opts.limit);
    }

    const rows = this.db.prepare(sql).all(...params) as LedgerRow[];
    return rows.map(toEntry);
  }

  /** The most recent line, or undefined on an empty ledger. */
  latest(): LedgerEntry | undefined {
    this.assertOpen();
    const row = this.db.prepare('SELECT * FROM ledger ORDER BY seq DESC LIMIT 1').get() as
      | LedgerRow
      | undefined;
    return row ? toEntry(row) : undefined;
  }

  /**
   * Walks the whole chain and recomputes every hash.
   *
   * Returns the length when every line matches its contents and points at the
   * line before it. Otherwise it returns the sequence number of the first line
   * that does not hold up, and a plain-English reason. An empty ledger is a
   * valid chain of length zero.
   */
  verifyChain(): ChainCheck {
    this.assertOpen();

    let expectedSeq = 1;
    let expectedPrevHash = GENESIS_PREV_HASH;
    let length = 0;

    for (const row of this.db
      .prepare('SELECT * FROM ledger ORDER BY seq ASC')
      .iterate() as IterableIterator<LedgerRow>) {
      if (row.seq !== expectedSeq) {
        return {
          ok: false,
          brokenAtSeq: row.seq,
          reason: `line ${expectedSeq} is missing, the ledger jumps to line ${row.seq}`,
        };
      }

      if (row.prev_hash !== expectedPrevHash) {
        return {
          ok: false,
          brokenAtSeq: row.seq,
          reason: 'this line does not point at the line before it',
        };
      }

      let recomputed: string;
      try {
        recomputed = hashEntry(row.prev_hash, toEntry(row));
      } catch {
        return {
          ok: false,
          brokenAtSeq: row.seq,
          reason: 'this line cannot be read back, its stored contents are not valid',
        };
      }

      if (recomputed !== row.hash) {
        return {
          ok: false,
          brokenAtSeq: row.seq,
          reason: 'the stored hash does not match the contents of this line, it was edited',
        };
      }

      expectedPrevHash = row.hash;
      expectedSeq += 1;
      length += 1;
    }

    return { ok: true, length };
  }

  /**
   * Adds up the recorded cost of every line at or after sinceIso, in dollars.
   *
   * This is how the daily data budget is measured, so it adds integer cents and
   * divides once at the end. Lines with no cost count as zero.
   *
   * Throws LedgerError if sinceIso is not a real date.
   */
  sumCostUsd(opts: { sinceIso: string; kinds?: LedgerKind[] }): number {
    this.assertOpen();

    const since = new Date(opts.sinceIso);
    if (Number.isNaN(since.getTime())) {
      throw new LedgerError(`sinceIso is not a date I can read: ${String(opts.sinceIso)}`);
    }

    if (opts.kinds !== undefined && opts.kinds.length === 0) {
      return 0;
    }

    const params: Array<string | number> = [since.toISOString()];
    let sql = 'SELECT COALESCE(SUM(cost_cents), 0) AS cents FROM ledger WHERE ts >= ?';

    if (opts.kinds !== undefined) {
      sql += ` AND kind IN (${opts.kinds.map(() => '?').join(',')})`;
      params.push(...opts.kinds);
    }

    const row = this.db.prepare(sql).get(...params) as { cents: number };
    return centsToUsd(row.cents);
  }

  /** Closes the file. Calling it twice is fine. */
  close(): void {
    if (!this.closed) {
      this.closed = true;
      this.db.close();
    }
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new LedgerError('this ledger is closed, open it again before reading or writing');
    }
  }

  private check(input: LedgerEntryInput): {
    kind: LedgerKind;
    actor: LedgerActor;
    payload: Record<string, unknown>;
    payloadJson: string;
    costUsd: number | undefined;
    costCents: number | null;
    txHash: string | undefined;
    orderId: string | undefined;
    sessionId: string | undefined;
  } {
    if (input === null || typeof input !== 'object') {
      throw new LedgerError('append needs an entry object');
    }

    if (!kindSet.has(input.kind)) {
      throw new LedgerError(`unknown ledger kind: ${String(input.kind)}`);
    }
    if (!actorSet.has(input.actor)) {
      throw new LedgerError(`unknown ledger actor: ${String(input.actor)}`);
    }

    const payload = input.payload;
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new LedgerError('payload must be a plain object, use {} when there is nothing to say');
    }

    // Storing the canonical form means a line read back from the database
    // serialises to exactly the bytes that were hashed on the way in.
    const payloadJson = canonicalJson(payload);

    const costCents = input.costUsd === undefined ? null : usdToCents(input.costUsd, 'costUsd');

    return {
      kind: input.kind,
      actor: input.actor,
      payload: JSON.parse(payloadJson) as Record<string, unknown>,
      payloadJson,
      costUsd: costCents === null ? undefined : centsToUsd(costCents),
      costCents,
      txHash: optionalText(input.txHash, 'txHash'),
      orderId: optionalText(input.orderId, 'orderId'),
      sessionId: optionalText(input.sessionId, 'sessionId'),
    };
  }
}

function optionalText(value: string | undefined, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || value.trim() === '') {
    throw new LedgerError(`${field} must be a non-empty string when it is given`);
  }
  if (value.length > 256) {
    throw new LedgerError(`${field} is longer than 256 characters`);
  }
  return value;
}

function toEntry(row: LedgerRow): LedgerEntry {
  return {
    seq: row.seq,
    ts: row.ts,
    kind: row.kind as LedgerKind,
    actor: row.actor as LedgerActor,
    payload: JSON.parse(row.payload) as Record<string, unknown>,
    ...(row.cost_cents === null ? {} : { costUsd: centsToUsd(row.cost_cents) }),
    ...(row.tx_hash === null ? {} : { txHash: row.tx_hash }),
    ...(row.order_id === null ? {} : { orderId: row.order_id }),
    ...(row.session_id === null ? {} : { sessionId: row.session_id }),
    prevHash: row.prev_hash,
    hash: row.hash,
  };
}
