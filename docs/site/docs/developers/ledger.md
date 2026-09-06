---
title: The ledger
sidebar_position: 5
description: The hash chain, the canonical JSON it is taken over, the SQL triggers, verifyChain, and every entry kind.
---

# The ledger

One SQLite file, one table, append only, hash chained. It is the durable record of every decision
Olai makes. `packages/agent/src/ledger/`.

## The table

```sql
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
```

Indexes on `ts` and `session_id`. The database opens with `journal_mode = WAL`,
`synchronous = FULL` and a 5 second busy timeout.

## The triggers

```sql
CREATE TRIGGER IF NOT EXISTS ledger_no_update BEFORE UPDATE ON ledger
BEGIN
  SELECT RAISE(ABORT, 'the ledger is append only, a line cannot be changed');
END;

CREATE TRIGGER IF NOT EXISTS ledger_no_delete BEFORE DELETE ON ledger
BEGIN
  SELECT RAISE(ABORT, 'the ledger is append only, a line cannot be removed');
END;
```

An UPDATE or a DELETE aborts at the database level, whoever sends it and whatever tool they use,
as long as they go through SQLite. Tampering therefore has to go around SQLite and edit the file
bytes, and that is exactly what the hash chain catches.

## The hash chain

```
hash = sha256( prevHash || canonicalJson({ seq, ts, kind, actor, payload, costUsd, txHash, orderId, sessionId }) )
```

The first line points at `GENESIS_PREV_HASH`, 64 zeroes, so the chain has one fixed starting
point anyone can check. Optional fields that are absent are hashed as `null`, so a line written
without a transaction hash and the same line read back from the database produce the same bytes.

**Canonical JSON** (`hash.ts`) is JSON with object keys sorted at every level. Two people have to
be able to recompute the same hash from the same line years apart, so the bytes that go into the
hash cannot depend on the order the keys happened to be written in. Arrays keep their order,
because in an array the order is part of the meaning. It refuses anything JSON cannot carry back
and forth unchanged: NaN, Infinity, bigint, functions, symbols, class instances, and nesting
deeper than 32 levels. The stored payload is the canonical form, so a line read back from the
database serialises to exactly the bytes that were hashed on the way in.

## Appending

`Ledger.append(entry)` returns the line as written, with its sequence number, timestamp and hash.

- **The timestamp is set by the ledger**, never by the caller, so nobody can backdate a line.
- **The read-then-write runs in one immediate transaction**, so two writers cannot both claim the
  same sequence number.
- **Unknown kinds and actors are refused**, as is a payload that is not a plain object, and a
  cost that is not a real non-negative dollar amount.
- **Money is stored as whole cents.** A day of one-cent payments added as floating point drifts,
  and a spend report that is a cent out is a report nobody trusts. `usdToCents` refuses NaN,
  Infinity, negatives, and anything past the point where cents stop fitting in a safe integer.

## Verifying

`Ledger.verifyChain()` walks the whole table in sequence order and recomputes every hash.

```ts
type ChainCheck =
  | { ok: true; length: number }
  | { ok: false; brokenAtSeq: number; reason: string };
```

It reports the first line that does not hold up, and there are four ways one can fail:

| Reason | What happened |
|---|---|
| `line N is missing, the ledger jumps to line M` | A row was removed by going around the triggers. |
| `this line does not point at the line before it` | The chain was cut or re-spliced. |
| `this line cannot be read back, its stored contents are not valid` | The stored payload no longer parses. |
| `the stored hash does not match the contents of this line, it was edited` | A field was changed. |

An empty ledger is a valid chain of length zero. `GET /api/ledger/verify` exposes this.

## Reading

`list({ afterSeq, limit, kinds, sessionId })` reads in sequence order, oldest first. With no
options it returns everything. An empty `kinds` array means nothing matches, which is different
from leaving `kinds` out.

`latest()` returns the most recent line. `sumCostUsd({ sinceIso, kinds })` adds the recorded cost
of every line at or after a timestamp, adding integer cents and dividing once at the end. That is
how the daily data budget is measured.

## The entry kinds

From `packages/agent/src/ledger/types.ts`. A change to this list is a change to the public record
format and to the hash of every line written after it.

```ts
type LedgerKind =
  | 'rulebook.set'
  | 'question'
  | 'discovery'
  | 'payment.preview'
  | 'payment.signed'
  | 'payment.settled'
  | 'data.received'
  | 'proposal'
  | 'approval'
  | 'rejection'
  | 'order.sent'
  | 'order.filled'
  | 'order.failed'
  | 'rule.refused'
  | 'kill'
  | 'resume'
  | 'note';
```

| Kind | Who writes it | What it means |
|---|---|---|
| `rulebook.set` | owner or system | A rulebook was saved. The whole rulebook is in the payload. |
| `question` | owner | A session started. |
| `discovery` | agent | A Bazaar search ran, with the query, the cap and the URLs found. |
| `payment.preview` | agent | A payment was priced and checked against the rulebook, before any signature. |
| `payment.signed` | agent | Olai is about to ask the wallet to sign. Written first on purpose. |
| `payment.settled` | agent | The paid call came back. Carries `costUsd` and `txHash`. |
| `data.received` | merchant | Data arrived from a merchant. |
| `proposal` | agent | A proposal that passed the rulebook, or a hold. |
| `approval` | owner | The owner approved. |
| `rejection` | owner | The owner rejected, with a reason. |
| `order.sent` | agent | An order left for Binance, or in a dry run was recorded with `dryRun: true`. |
| `order.filled` | binance | The venue filled it. |
| `order.failed` | binance | The venue refused it, or the call threw. |
| `rule.refused` | rulebook | The rulebook refused something, with reasons and rule ids. |
| `kill` | owner | The kill switch went on. |
| `resume` | owner | The kill switch went off. |
| `note` | any | Everything else worth recording: a free market read, the day's opening equity, a tool failure. |

The six actors are `owner`, `agent`, `rulebook`, `binance`, `merchant` and `system`, so "who did
this" is answerable without reading the payload.

Optional fields on a line: `costUsd`, `txHash`, `orderId`, `sessionId`. Each is a non-empty
string of at most 256 characters when present, except `costUsd`, which is money.
