import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GENESIS_PREV_HASH } from '../../src/ledger/hash.js';
import { Ledger } from '../../src/ledger/ledger.js';
import { LedgerError } from '../../src/ledger/types.js';

// What this file does NOT cover: how the agent decides what to record, the
// random-append property (see ledger.property.test.ts), and what happens when
// two operating system processes write the same file at the same moment. It
// also does not cover file permissions or disk-full behaviour.

let dir: string;
let dbPath: string;
let ledger: Ledger;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'olai-ledger-'));
  dbPath = join(dir, 'nested', 'olai.db');
  ledger = new Ledger(dbPath);
});

afterEach(() => {
  vi.useRealTimers();
  ledger.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('Ledger.append', () => {
  it('creates the folder, numbers the first line 1 and points it at the genesis hash', () => {
    expect(existsSync(dbPath)).toBe(true);

    const entry = ledger.append({ kind: 'note', actor: 'system', payload: { text: 'hello' } });

    expect(entry.seq).toBe(1);
    expect(entry.prevHash).toBe(GENESIS_PREV_HASH);
    expect(entry.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(entry.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('chains each line onto the one before it', () => {
    const first = ledger.append({ kind: 'question', actor: 'owner', payload: { text: 'trim BNB?' } });
    const second = ledger.append({ kind: 'proposal', actor: 'agent', payload: { size: 25 } });

    expect(second.seq).toBe(2);
    expect(second.prevHash).toBe(first.hash);
    expect(second.hash).not.toBe(first.hash);
  });

  it('keeps money to the cent and gives the optional fields back as written', () => {
    const entry = ledger.append({
      kind: 'payment.settled',
      actor: 'merchant',
      payload: { merchant: 'nansen' },
      costUsd: 0.01,
      txHash: '0xabc',
      orderId: 'none',
      sessionId: 's1',
    });

    expect(entry.costUsd).toBe(0.01);
    expect(entry.txHash).toBe('0xabc');
    expect(ledger.list()[0]).toEqual(entry);
  });

  it('refuses anything it cannot record honestly', () => {
    expect(() => ledger.append({ kind: 'nope' as 'note', actor: 'system', payload: {} })).toThrow(
      LedgerError,
    );
    expect(() => ledger.append({ kind: 'note', actor: 'nobody' as 'system', payload: {} })).toThrow(
      LedgerError,
    );
    expect(() =>
      ledger.append({ kind: 'note', actor: 'system', payload: [] as unknown as Record<string, unknown> }),
    ).toThrow(LedgerError);
    expect(() =>
      ledger.append({ kind: 'note', actor: 'system', payload: {}, costUsd: -1 }),
    ).toThrow(LedgerError);
    expect(() =>
      ledger.append({ kind: 'note', actor: 'system', payload: {}, costUsd: Number.NaN }),
    ).toThrow(LedgerError);
    expect(() =>
      ledger.append({ kind: 'note', actor: 'system', payload: { bad: Number.POSITIVE_INFINITY } }),
    ).toThrow(LedgerError);
    expect(() => ledger.append({ kind: 'note', actor: 'system', payload: {}, txHash: '  ' })).toThrow(
      LedgerError,
    );
  });
});

describe('Ledger.list and Ledger.latest', () => {
  beforeEach(() => {
    ledger.append({ kind: 'question', actor: 'owner', payload: { n: 1 }, sessionId: 'a' });
    ledger.append({ kind: 'proposal', actor: 'agent', payload: { n: 2 }, sessionId: 'a' });
    ledger.append({ kind: 'note', actor: 'system', payload: { n: 3 }, sessionId: 'b' });
  });

  it('reads oldest first and pages forward with afterSeq and limit', () => {
    expect(ledger.list().map((entry) => entry.seq)).toEqual([1, 2, 3]);
    expect(ledger.list({ afterSeq: 1, limit: 1 }).map((entry) => entry.seq)).toEqual([2]);
  });

  it('narrows by kind and by session, and treats an empty kinds list as nothing', () => {
    expect(ledger.list({ kinds: ['note'] }).map((entry) => entry.seq)).toEqual([3]);
    expect(ledger.list({ sessionId: 'a' }).map((entry) => entry.seq)).toEqual([1, 2]);
    expect(ledger.list({ kinds: [] })).toEqual([]);
    expect(ledger.list({ sessionId: 'missing' })).toEqual([]);
  });

  it('gives the newest line, and nothing at all on an empty ledger', () => {
    expect(ledger.latest()?.seq).toBe(3);

    const empty = new Ledger(':memory:');
    expect(empty.latest()).toBeUndefined();
    expect(empty.verifyChain()).toEqual({ ok: true, length: 0 });
    expect(empty.sumCostUsd({ sinceIso: '1970-01-01T00:00:00.000Z' })).toBe(0);
    empty.close();
  });
});

describe('Ledger.sumCostUsd', () => {
  it('adds cents exactly, and only counts the window and kinds asked for', () => {
    vi.useFakeTimers();

    vi.setSystemTime(new Date('2026-09-05T10:00:00.000Z'));
    ledger.append({ kind: 'payment.settled', actor: 'merchant', payload: {}, costUsd: 0.1 });

    vi.setSystemTime(new Date('2026-09-06T10:00:00.000Z'));
    ledger.append({ kind: 'payment.settled', actor: 'merchant', payload: {}, costUsd: 0.1 });
    ledger.append({ kind: 'payment.settled', actor: 'merchant', payload: {}, costUsd: 0.1 });
    ledger.append({ kind: 'note', actor: 'system', payload: {}, costUsd: 5 });
    ledger.append({ kind: 'note', actor: 'system', payload: {} });

    expect(ledger.sumCostUsd({ sinceIso: '1970-01-01T00:00:00.000Z' })).toBe(5.3);
    expect(ledger.sumCostUsd({ sinceIso: '2026-09-06T00:00:00.000Z' })).toBe(5.2);
    expect(
      ledger.sumCostUsd({ sinceIso: '2026-09-06T00:00:00.000Z', kinds: ['payment.settled'] }),
    ).toBe(0.2);
    expect(ledger.sumCostUsd({ sinceIso: '2026-09-07T00:00:00.000Z' })).toBe(0);
    expect(() => ledger.sumCostUsd({ sinceIso: 'today' })).toThrow(LedgerError);
  });
});

describe('the ledger is append only', () => {
  it('lets the database itself refuse an UPDATE and a DELETE', () => {
    ledger.append({ kind: 'note', actor: 'system', payload: { text: 'first' } });

    const raw = new Database(dbPath);
    try {
      expect(() => raw.prepare("UPDATE ledger SET payload = '{}' WHERE seq = 1").run()).toThrow(
        /append only/,
      );
      expect(() => raw.prepare('DELETE FROM ledger WHERE seq = 1').run()).toThrow(/append only/);
    } finally {
      raw.close();
    }

    expect(ledger.verifyChain()).toEqual({ ok: true, length: 1 });
  });

  it('names the line that was edited once someone drops the trigger and rewrites it', () => {
    ledger.append({ kind: 'question', actor: 'owner', payload: { text: 'trim BNB?' } });
    ledger.append({ kind: 'order.sent', actor: 'agent', payload: { quoteUsd: 25 } });
    ledger.append({ kind: 'order.filled', actor: 'binance', payload: { quoteUsd: 25 } });

    const raw = new Database(dbPath);
    raw.exec('DROP TRIGGER ledger_no_update');
    raw.prepare('UPDATE ledger SET payload = ? WHERE seq = ?').run('{"quoteUsd":2500}', 2);
    raw.close();

    const check = ledger.verifyChain();

    expect(check.ok).toBe(false);
    expect(check).toMatchObject({ brokenAtSeq: 2 });
    expect(check.ok === false && check.reason).toContain('edited');
  });

  it('spots a line that was removed', () => {
    ledger.append({ kind: 'note', actor: 'system', payload: { n: 1 } });
    ledger.append({ kind: 'note', actor: 'system', payload: { n: 2 } });

    const raw = new Database(dbPath);
    raw.exec('DROP TRIGGER ledger_no_delete');
    raw.prepare('DELETE FROM ledger WHERE seq = 1').run();
    raw.close();

    expect(ledger.verifyChain()).toEqual({
      ok: false,
      brokenAtSeq: 2,
      reason: 'line 1 is missing, the ledger jumps to line 2',
    });
  });
});

describe('Ledger.close', () => {
  it('survives being closed twice and refuses work afterwards', () => {
    ledger.append({ kind: 'note', actor: 'system', payload: {} });
    ledger.close();
    ledger.close();

    expect(() => ledger.list()).toThrow(LedgerError);
  });

  it('picks the chain back up when the same file is opened again', () => {
    const first = ledger.append({ kind: 'note', actor: 'system', payload: { n: 1 } });
    ledger.close();

    const reopened = new Ledger(dbPath);
    const second = reopened.append({ kind: 'note', actor: 'system', payload: { n: 2 } });

    expect(second.prevHash).toBe(first.hash);
    expect(reopened.verifyChain()).toEqual({ ok: true, length: 2 });
    reopened.close();
  });
});
