---
title: Read the ledger
sidebar_position: 4
description: Every line kind, how to page through them, and how to check that nobody has edited one.
---

# Read the ledger

The ledger is the record. Everything else, the event stream, the session record, the model's own
account of what it bought, is commentary.

## From the desk

The Ledger panel lists lines newest first, filtered by the chips above it: Everything, Payments,
Orders, Rules, Notes. Click a line to expand it: the actor, the line number, the hash, a link to
BscScan when the line carries a transaction hash, and the raw JSON payload underneath. The
**Verify chain** button recomputes the whole hash chain on the service, not anything already in
the browser, and reports either "Chain holds across N lines" or "Broken at line N" with the
reason, the same two shapes `GET /api/ledger/verify` returns below. This is
`packages/web/src/components/desk/ledger-table.tsx`.

## From the command line

```bash
curl "http://localhost:4000/api/ledger?limit=50" \
  -H "Authorization: Bearer $OLAI_OWNER_TOKEN"
```

```json
{
  "entries": [
    {
      "seq": 14,
      "ts": "2026-09-06T09:12:51.882Z",
      "kind": "payment.settled",
      "actor": "agent",
      "payload": { "summary": "Paid $0.0100 for ...", "url": "..." },
      "costUsd": 0.01,
      "txHash": "0x...",
      "sessionId": "ol-3f0c...",
      "prevHash": "9f2a...",
      "hash": "c471..."
    }
  ],
  "nextAfterSeq": 14
}
```

`nextAfterSeq` is what to send as `afterSeq` to get the next page. `null` means you have reached
the end.

## Query it

| Parameter | Meaning |
|---|---|
| `afterSeq` | Return lines after this sequence number. This is how you page forward. |
| `limit` | 1 to 500, default 100. |
| `kinds` | A comma-separated list of line kinds. An unknown kind is a 400 naming it. |
| `sessionId` | Only lines from one question. |

Every data payment in one session, for example:

```bash
curl "http://localhost:4000/api/ledger?sessionId=ol-3f0c...&kinds=payment.preview,payment.signed,payment.settled" \
  -H "Authorization: Bearer $OLAI_OWNER_TOKEN"
```

## The line kinds

From `packages/agent/src/ledger/types.ts`.

| Kind | Written when |
|---|---|
| `rulebook.set` | A rulebook is saved. The whole rulebook is in the payload. |
| `question` | A question starts a session. |
| `discovery` | A Bazaar search ran. The payload carries the query, the price cap and the URLs found. |
| `payment.preview` | A payment was priced and checked against the rulebook, before any signature. |
| `payment.signed` | Olai is about to ask the wallet to sign. Written before the signature, so a crash mid-payment cannot lead to a second one. |
| `payment.settled` | The merchant answered the paid call. Carries `costUsd` and the settlement `txHash`. |
| `data.received` | Data came back from a merchant. |
| `proposal` | The agent proposed an action that passed the rulebook, or proposed holding. |
| `approval` | The owner approved. |
| `rejection` | The owner rejected, with their reason. |
| `order.sent` | An order left for Binance, or, in a dry run, was recorded and not sent (`dryRun: true`). |
| `order.filled` | Binance filled it. |
| `order.failed` | Binance refused it, or the call threw. |
| `rule.refused` | The rulebook refused something. Carries the reasons and the rule ids. |
| `kill` | The kill switch went on. |
| `resume` | The kill switch went off. |
| `note` | Everything else worth recording: a free market read, the day's opening equity, a tool failure. |

The actor on each line is one of `owner`, `agent`, `rulebook`, `binance`, `merchant`, `system`,
so "who did this" is answerable without reading the payload.

## Check that nobody edited it

```bash
curl http://localhost:4000/api/ledger/verify \
  -H "Authorization: Bearer $OLAI_OWNER_TOKEN"
```

```json
{ "ok": true, "length": 148 }
```

A broken chain answers with the first line that does not hold up and why:

```json
{ "ok": false, "brokenAtSeq": 91, "reason": "the stored hash does not match the contents of this line, it was edited" }
```

Three reasons it can give: a missing line ("line 90 is missing, the ledger jumps to line 91"), a
line that does not point at the line before it, or a line whose stored hash does not match its
contents.

## What the numbers mean

Money is stored as whole cents and shown back as dollars. `costUsd` on a `payment.settled` line
is what that one call cost. The daily data budget is measured by adding the cents on settled
payments since midnight UTC, which is why the total is exact rather than a floating-point
approximation of exact.

The one number to read with care is the daily loss on `GET /api/account`. It is the difference
between the account's equity now and its equity at the first read of the UTC day, so it counts
unrealised price moves on positions you were already holding, not only losses from trades Olai
made. That is a stated weakness, not a bug in the arithmetic.
