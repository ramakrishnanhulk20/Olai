---
title: Owner API
sidebar_position: 2
description: Every route in src/api/app.ts with its method, auth, body, response and errors.
---

# Owner API

Every route lives in `packages/agent/src/api/app.ts`. There is one user, the owner, and one
token. The owner's desk (`packages/web/src/app/app/page.tsx`) is the one browser client of this
API; every example below also works from a terminal, which is how they are written.

## What applies to every route

- **Auth.** Every route under `/api/*` needs `Authorization: Bearer <owner token>`, checked by
  `ownerAuth` in `packages/agent/src/api/auth.ts`. `/health` needs no token. The desk keeps this
  token in the browser's `sessionStorage`, under the key `olai.owner-token`
  (`packages/web/src/lib/token.ts`), reads it straight into this header on every call, and never
  places it in a URL, a cookie, a React key, or a log; a 401 clears it and drops back to the gate
  screen. The OAuth routes are a separate group, described at the bottom of this page.
- **Rate limit.** 60 requests per 60 seconds per address, counted on the socket address unless
  `OLAI_TRUST_PROXY` is `true`, in which case the first entry of `X-Forwarded-For` is used.
  Over the limit is a 429.
- **Body limit.** 64 KB on every route. Over it is a 413.
- **CORS.** One origin, `OLAI_WEB_ORIGIN`, allowed for GET, POST, PUT and OPTIONS with the
  `Authorization` and `Content-Type` headers. This is the one origin the desk itself runs from;
  nothing else in a browser can call this API. The check runs before the token is looked at,
  because a browser has to be told no on the preflight.
- **Errors.** The caller learns what they did wrong and nothing else. An unexpected error is a
  flat 500 with no detail, because a stack trace or a file path in an HTTP body is a map of the
  machine.

## Routes

### GET /health

No token. Returns `{ ok: true, dryRun, killed, version }`. This is what a monitor watches.

### GET /api/rulebook

Returns the stored rulebook, or the starter default when nothing has been saved yet. See
[Write a rulebook](../guides/write-a-rulebook.md).

### PUT /api/rulebook

Body: a rulebook object. Returns the saved, validated rulebook. Writes a `rulebook.set` ledger
line.

A rulebook that fails the schema is a 400 carrying `issues`, the exact list of fields and reasons
from the validator. A file that cannot be written is a 500.

### POST /api/ask

Body: `{ "question": string }`, 1 to 2000 characters after trimming. Returns a session record:
`id`, `question`, `createdAt`, `status`, and, once the analyst finishes, `proposal` and
`verdict`.

This is the only route that spends Anthropic tokens and the only one that can trigger a data
payment. Ledger lines it can produce: `question`, `discovery`, `payment.preview`,
`payment.signed`, `payment.settled`, `data.received`, `note`, `proposal`, `rule.refused`.

An empty question is a 400.

### GET /api/sessions

Returns every session record held in memory, oldest first. Records do not survive a restart. The
ledger does.

### GET /api/sessions/:id

One session record. 404 when there is no session with that id. An id longer than 128 characters
is a 400.

### POST /api/sessions/:id/approve

No body. Returns the updated session record. See [Approve or reject](../guides/approve-or-reject.md)
for the full order of checks.

Ledger lines: `approval`, then `order.sent`, then `order.filled` or `order.failed`. Or
`rule.refused` if the second rulebook check fails.

409 when the session is not pending. 404 when the id is unknown.

### POST /api/sessions/:id/reject

Body: `{ "reason"?: string }`, up to 500 characters, defaulting to "The owner gave no reason."
Returns the updated session record and writes a `rejection` line. 409 when the session is not
pending.

### POST /api/kill

No body. Returns `{ "killed": true }` and writes a `kill` line.

### POST /api/resume

No body. Returns `{ "killed": false }` and writes a `resume` line.

### GET /api/ledger

Query: `afterSeq` (a whole number, 0 or more), `limit` (1 to 500, default 100), `kinds` (a
comma-separated list of line kinds), `sessionId`.

Returns `{ entries, nextAfterSeq }`. `nextAfterSeq` is the sequence number to send as `afterSeq`
for the next page, or `null` at the end. An unknown kind is a 400 naming it.

### GET /api/ledger/verify

Returns `{ ok: true, length }` or `{ ok: false, brokenAtSeq, reason }`. Recomputes every hash in
the table.

### GET /api/account

Returns the account state the rulebook is checked against: equity, today's loss, today's data
spend, open positions, the time of the last order, and the killed flag.

The first call of a new UTC day writes one `note` line recording the day's opening equity, which
is the number today's loss is measured from. A failed exchange read is a 502.

### GET /api/wallet

Returns `{ status, settings, balances }` from the `baw` CLI. When no wallet is configured it
returns `{ status: 'unavailable', settings: null, balances: [] }`; when the wallet is not signed
in it returns the status with nulls rather than an error, because "not connected" is an answer,
not a failure. A CLI failure is a 502.

### GET /api/bazaar/search

Query: `query` (1 to 200 characters) and optional `maxUsdPrice` (positive, at most 1000). Returns
`{ resources }`. 503 when the agent has no Bazaar connection configured, 502 when the Bazaar call
fails.

### GET /api/events

A server-sent event stream. The first thing written is a `ready` event, so a client knows its
subscription is live before it does anything that would produce an event. A heartbeat comment
follows every 15 seconds to stop a proxy closing an idle stream. At most 16 streams may be open
at once; the seventeenth is a 503.

This is the live commentary feed, not the durable record. The desk reads it with `fetch` and a
stream reader rather than `EventSource`, because `EventSource` cannot carry the `Authorization`
header the token needs (`packages/web/src/lib/sse.ts`).

## Status codes

| Code | When |
|---|---|
| 400 | The body or query failed its schema. `issues` carries the detail. |
| 401 | Missing or wrong bearer token. Every refusal is logged with the address and the path. |
| 404 | No such session, or no such route. |
| 409 | The session is not in a state where that action makes sense. |
| 413 | The body is over 64 KB. |
| 429 | Over 60 requests in the window from this address. |
| 502 | An upstream failed: the exchange, the wallet CLI, or the Bazaar. |
| 503 | A dependency is not configured, or too many event streams are open. |
| 500 | Something unexpected. The detail is in the agent log, not in the response. |

## The OAuth routes

`packages/agent/src/mcp/oauth.ts` exports a separate router, mounted at the root by
`packages/agent/src/boot.ts`. These routes are outside the `/api/*` prefix that the owner token
guards.

| Route | Method | What it does |
|---|---|---|
| `/oauth/client-metadata.json` | GET | Olai's client description. Public on purpose: Binance fetches it, and its URL is Olai's client id. |
| `/oauth/start` | GET | Owner token required. Redirects to Binance's consent screen with PKCE and a fresh `state`. |
| `/oauth/callback` | GET | Binance returns here. Checks `state`, exchanges the code, writes the token file. Answers `{ connected, scope, expiresAt }` or a 400 with the failure code. |
| `/oauth/status` | GET | Owner token required. `{ connected, clientId, scope, expiresAt }`. |
| `/oauth/disconnect` | POST | Owner token required. Deletes the stored token. |

`/oauth/client-metadata.json` and `/oauth/callback` are public on purpose: Binance fetches the
first and redirects to the second, and the callback is protected by the PKCE `state` check. The
three routes that start, inspect or drop the Binance session take the owner token like every
`/api` route. See the [threat model](../security/threat-model.md).
