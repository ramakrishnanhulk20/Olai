---
title: Threat model
sidebar_position: 2
description: Who the attackers are, every entry point, the controls mapped to code, and the weaknesses we did not fix.
---

# Threat model

This page is the project's threat model, `docs/security/threat-model.md`, adapted for the site.
Where the two differ, the file in the repository is the original.

Written from the code as it exists in `packages/agent/src`. The routes under
`src/api` exist and are wired, and the rulebook engine, ledger, x402 buyer, Bazaar client, the
exchange REST client and the MCP client are all coded. The owner's desk now ships too, at `/app`
(`packages/web/src/app/app/page.tsx`), and is covered below as its own entry point, because a
browser is a different kind of target than a terminal calling curl directly.

Olai trades through Binance's exchange REST API on an isolated sub-account
(`src/exchange/rest.ts`), not through the Binance MCP server. Binance's own consent page turned
Olai's OAuth client away as an unsupported agent (its allowlist admits only Binance's own agents
today), so the MCP client in `src/mcp` stays coded and tested but held unused. See
[Why Binance Agent OS](../concepts/why-binance-agent-os.md).

## 1. Assets

What an attacker could take or break, and why each one matters.

- **The Agentic sub-account funds.** The Binance sub-account Olai trades on
  (`src/exchange/rest.ts`, `src/mcp/exchange.ts`, `src/ports/exchange.ts`). The key has no
  withdrawal permission, but an attacker who can place orders can still lose the owner money on
  bad trades or waste it on fees.
- **The Binance API key and secret.** `BINANCE_API_KEY` and `BINANCE_API_SECRET`
  (`src/config.ts`), used only to build an HMAC signature (`src/exchange/sign.ts`). The secret
  never leaves the process as anything but that signature, and the key is logged masked. Whoever
  holds both can trade on the sub-account up to its balance, though never withdraw.
- **The Agentic Wallet funds and its 48 hour session.** The on-chain wallet the `baw` CLI drives
  for x402 payments (`src/x402/baw.ts`). The wallet's own sign-in session is time-boxed. Olai
  holds no keys itself, only calls the CLI.
- **The Binance MCP OAuth token file.** `OLAI_TOKEN_PATH`, written and read by `src/mcp/oauth.ts`.
  Whoever holds this file can act as Olai against the live MCP server until Binance's token
  expires or is revoked.
- **The owner token.** Checked in `src/api/auth.ts`. Whoever holds this bearer token can write the
  rulebook, ask questions, approve orders, and hit kill or resume through every `/api/*` route.
- **The Anthropic API key.** `ANTHROPIC_API_KEY`, read once in `src/config.ts` and used to build
  the client passed into `runAnalyst`. A leaked key lets someone spend the owner's Anthropic
  budget or impersonate the brain's requests.
- **The ledger's integrity.** The hash-chained SQLite file. This is the one audit trail of every
  decision, payment and order. If it can be silently edited, nothing else Olai claims is
  provable.
- **The owner's decisions.** The rulebook (`src/policy/rulebook.ts`, `src/rulebook/store.ts`) and
  every approve, reject, kill and resume act (`src/session/session.ts`). An attacker who can forge
  an approval or edit a rulebook file undetected has taken over what the owner believes they
  control.

## 2. Attackers

- **A prompt-injecting merchant.** Every Bazaar listing and every 402 response body is untrusted
  text the model reads. A merchant can put instructions in its description or its JSON payload
  hoping the model acts on them instead of on the rulebook.
- **A malicious or compromised Bazaar listing.** `src/bazaar/client.ts` parses the public,
  unauthenticated Bazaar endpoints with schemas, but the `description` and `url` fields are free
  text from whoever listed the resource.
- **Someone on the local network, or anyone who has the desk's URL and no token.** Every
  `/api/*` route requires the owner bearer token. The risk is a leaked URL, a shared screen, or a
  network peer trying without the token.
- **A stolen laptop.** Whoever has filesystem access to `OLAI_TOKEN_PATH`, `OLAI_DB_PATH` and
  the rulebook file gets the MCP session, the whole ledger and the current rulebook, though not
  the owner token or the Anthropic key, which live only in environment variables and are not
  written to disk by Olai.
- **A bug in our own code.** A schema that is too loose, a race in the ledger's sequence
  numbering, or a tool-name mismatch in `src/mcp/toolmap.ts` that silently routes a call to the
  wrong tool.
- **The model itself acting outside the rulebook.** The design assumes the model will sometimes
  try. The defence is that its output is checked in code, never trusted as a decision.

## 3. Entry points

| Entry point | Where in code | What reaches it |
|---|---|---|
| The desk in the browser | `packages/web/src/app/app/page.tsx`, `packages/web/src/components/desk/*` | The owner's own browser tab. Gated by the owner token, held in `sessionStorage` and sent as the `Authorization` header on every call; a 401 clears it. Every call goes to a route below, from the one origin CORS allows. The landing page at `/` is separate and unauthenticated: it reads only public `/health` and an exported ledger sample, holding no token at all |
| `GET /health` | `src/api/app.ts` | Public, no auth, returns `ok`, `dryRun`, `killed`, `version` only |
| `GET /api/rulebook`, `PUT /api/rulebook` | `src/api/app.ts` | Owner token; body validated by `rulebookSchema` before `RulebookStore.save` |
| `POST /api/ask` | `src/api/app.ts` | Owner token; runs `SessionRunner.ask` then `runAnalyst`, the only entry that spends Anthropic tokens and can trigger `buy_data` |
| `GET /api/sessions`, `GET /api/sessions/:id` | `src/api/app.ts` | Owner token; read-only, in-memory runner state |
| `POST /api/sessions/:id/approve` | `src/api/app.ts` | Owner token; the one path that can place a real order |
| `POST /api/sessions/:id/reject` | `src/api/app.ts` | Owner token |
| `POST /api/kill`, `POST /api/resume` | `src/api/app.ts` | Owner token; flips the runner's killed flag |
| `GET /api/ledger`, `GET /api/ledger/verify` | `src/api/app.ts` | Owner token; read-only |
| `GET /api/account` | `src/api/app.ts` | Owner token; `AccountStateSource.snapshot` |
| `GET /api/wallet` | `src/api/app.ts` | Owner token; proxies the `baw` status, settings and balance calls |
| `GET /api/bazaar/search` | `src/api/app.ts` | Owner token; proxies `BazaarClient.search` |
| `GET /api/events` (SSE) | `src/api/app.ts` | Owner token; capped at 16 concurrent streams |
| The five OAuth routes | `src/mcp/oauth.ts` | No owner-token middleware; they sit outside the `/api/*` prefix. `client-metadata.json` is meant to be public, because Binance fetches it. `/oauth/callback` is protected by the PKCE `state` check, not a bearer token. |
| Client metadata document | `src/mcp/oauth.ts` | Must be publicly reachable over HTTPS for Binance's authorization server to fetch it |
| The `baw` CLI subprocess | `src/x402/baw.ts` | Runs with `reject: false`, no shell, arguments passed as an array rather than a shell string, 120 second timeout |
| Merchant HTTP responses | `src/x402/buyer.ts`, `src/x402/paymentRequired.ts` | Untrusted network responses, parsed through schemas before use |
| Binance exchange REST API | `src/exchange/rest.ts` | Signed GET `/api/v3/account` and `/api/v3/order`, signed POST `/api/v3/order` (market orders by `quoteOrderQty`, `newClientOrderId` equal to the session id), and public GET `/api/v3/ticker/24hr`, `/api/v3/depth`, `/api/v3/klines`, `/api/v3/exchangeInfo`. The secret only ever appears as an HMAC signature; the key is logged masked |
| Claude API responses | `src/brain/analyst.ts` | The model's own tool calls and its final `propose` call, constrained by `proposalSchema` |
| The SQLite ledger file | `src/ledger/ledger.ts` | `OLAI_DB_PATH`; append-only via SQL triggers, readable by anyone with filesystem access |
| The rulebook file | `src/rulebook/store.ts` | Plain JSON on disk, no encryption; an edit is only trusted if it re-parses under the schema |
| `.env` | `src/config.ts` | Read once at boot; holds `ANTHROPIC_API_KEY` and every other setting |

## 4. Controls, mapped to code

**The exchange key never appears as itself.** `src/exchange/sign.ts` turns every signed request
into a query string plus an HMAC-SHA256 signature computed from `BINANCE_API_SECRET`; the secret
itself is never sent, logged, or placed in a URL parameter. `src/exchange/rest.ts` logs the API
key masked. A POST that places an order is never retried on a lost answer: it asks Binance what
happened by `newClientOrderId` (the session id) instead of sending a second order.

**The rulebook engine.** `evaluate(rulebook, action, state)` in `src/policy/engine.ts` is a pure
function with no clock read and no database read. It is called in three places, always before
anything moves: inside `buy_data` before the payment, in `SessionRunner.ask` right after a
proposal comes back, and in `SessionRunner.approve` against a fresh account snapshot. The rulebook
is validated by `rulebookSchema` before it is ever saved, and `evaluate` re-checks its shape at
runtime and refuses everything if it does not look real.

**The ledger hash chain and its SQL triggers.** Every line's hash covers the previous line's hash
plus its own canonical JSON, so editing an old line breaks every later hash. `verifyChain()` walks
the whole table and returns the first broken sequence number. The `ledger_no_update` and
`ledger_no_delete` triggers make UPDATE and DELETE abort at the database level, so tampering must
go around SQLite entirely, which `verifyChain` is built to catch.

**The one-signature-per-payment guard.** `src/x402/buyer.ts` requires two hooks,
`alreadySigned` and `markSigned`, and `ledgerSignatureGuard` in `src/ports/data.ts` backs
them with the ledger: a `payment.signed` line is written immediately before the wallet is
asked to sign, not after, so a signature that throws still counts as used, and a repeat call
for the same id is refused without touching the wallet. Because the claim is a ledger line,
it survives a restart (executed as ATTACK-04).

**The dry-run flag.** `OLAI_DRY_RUN`, default `true`, threaded through three places: the system
text the model reads, the buyer, which returns `dry-run` before signing, and the session runner,
which records an `order.sent` line marked `dryRun: true` and never calls the exchange.

**The kill switch.** `SessionRunner.kill()` and `resume()`, backed by a private flag.
`SessionRunner.state()` always ORs that flag over whatever the account read returns, so a stale
account read can never un-kill the agent, and `evaluate()` refuses everything the instant
`state.killed` is true. Kill does not cancel an order already in flight (see gap 5).

**The owner token prefix and constant-time compare.** `src/api/auth.ts`: the `ol.` prefix, a
minimum length of 24, a boot-time check that refuses to start with a bad token, and a compare that
sha256-hashes both sides before `timingSafeEqual`, so tokens of different lengths still compare in
constant time and the real token's length is not leaked by timing.

**Rate limiting.** A fixed window per client address, 60 requests per 60 seconds, counted on the
socket address unless `trustProxy` is explicitly set. Above 1024 tracked addresses, expired
windows are swept on each request.

**OAuth state and PKCE checks.** `startAuthorization` mints a random state and a PKCE verifier
through the MCP SDK. `handleCallback` rejects on an error from the server, on no pending flow, on
a state mismatch, and on a missing code. The RFC 8707 `resource` parameter pins the token to the
configured MCP URL.

**Schemas at every boundary.** The API bodies and queries, the Bazaar responses, the MCP tool
answers, the `baw` CLI's JSON envelope, and the merchant's 402 payload are all parsed before use.
Nothing from outside the process is used unparsed.

**The desk adds a browser, so it is scoped like one.** A script that ran inside the page could
read `sessionStorage` the same way the desk's own code does. The mitigation is in what the desk
refuses to load or render: no third-party script tag anywhere in the bundle, and nothing from the
network is ever rendered as HTML, only as text. The token lives in `sessionStorage`, not
`localStorage`, so it dies with the tab. `OLAI_WEB_ORIGIN` is the only origin the API's CORS
answers, so no other site can get a browser to carry the token to it. The landing page at `/` is a
separate, unauthenticated surface: it reads only public `/health` and an exported ledger sample,
so there is nothing on it for a browser bug to leak.

**Binance's own controls, relied upon.** No withdrawal scope exists for the MCP server. The
Agentic sub-account is walled off from the owner's main account. The Agentic Wallet has a daily
limit and a separate x402 daily limit, set only in the Binance app. Wallet sends only go to
addresses already in the app's address book. Binance's own skills document a confirm-before-execute
pattern, and Olai's owner-approval gate is the equivalent it implements itself, since Olai does
not run inside Claude Code and gets no external confirm prompt.

## 5. The attack list

Each of these has an executed script and saved output. See [Audits](./audits.md).

| # | Attack | Expected result | Control |
|---|---|---|---|
| 1 | Prompt injection through a merchant response telling the agent to buy ten times the limit | refused | `checkPayment` and `checkOrder` in `policy/engine.ts`, which run in code whatever the model says |
| 2 | A proposal above `maxOrderUsd` | refused before the owner sees it | `SessionRunner.ask` calling `evaluate()` immediately after the proposal |
| 3 | Approving twice | one order sent | the early return in `approve` and the `ordered` set, added to before the exchange call |
| 4 | A replayed x402 signature | refused the second time | the signed payment id set, claimed before signing |
| 5 | Editing a ledger row directly in the SQLite file | `/api/ledger/verify` reports the first broken sequence number | `verifyChain()`, plus the triggers, which stop an in-process edit but not a raw file edit, which is exactly what verify is for |
| 6 | Forging the owner token by using a session id | 401 | the constant-time compare, and session ids and owner tokens living in disjoint namespaces on purpose |
| 7 | A rulebook with NaN | refused at save time, and again at evaluation time | the money refinement in `rulebookSchema`, with `isCleanUsd` and `rulebookLooksReal` as the runtime backstop |
| 8 | A symbol not on the allow list | refused | `order.symbol_not_allowed` |
| 9 | Kill, then approve | refused | the killed flag ORed into the state, and `agent.killed` in the engine |
| 10 | Calling the API from a second address past the rate limit | the first address gets 429; a genuinely different address gets its own window | a stated limit of address-based rate limiting, not a bypass of the token check |
| 11 | Reading the token file's permissions | `0600` on POSIX | set in `oauth.ts` after every write. On Windows the chmod is a no-op and this attack reports that gap explicitly |
| 12 | Grepping the repository and git history for secrets | nothing committed | `.env.example` carries blank placeholders only; the real `.env`, token file and database are ignored by git, and the script verifies that rather than assuming it |

## 6. Weaknesses we did not fix

1. **Daily loss counts unrealised moves.** It is computed from equity snapshots
   (`src/account/state.ts`), so a held position that merely drops in price today trips
   `maxDailyLossUsd` and the drawdown tiers exactly as a realised loss would.
2. **In-memory state does not survive a restart.** The session list, the ordered set and the
   in-process signature guard are gone after a restart. The ledger is still the durable record of
   what happened, and the ledger-backed signature guard still holds, but the in-process guards
   against a double send are rebuilt from nothing.
3. **Merchant text is trusted as data after schema validation.** Nothing strips or flags
   instruction-like text inside a merchant's description or JSON body before the model reads it.
   The defence is entirely downstream, in the rulebook refusing whatever the model proposes.
4. **The model writes its own `dataUsed` list.** The system text tells it never to invent a cost
   or a hash, but nothing in code cross-checks that list against what the ledger recorded from
   `buy_data` in the same session.
5. **No cancel of in-flight orders on kill.** Kill stops every future rulebook check from passing.
   It does not touch an order already sent to Binance.
6. **The public base URL for OAuth must be a tunnel in development.** The loopback default cannot
   be reached by Binance's authorization server to fetch the client metadata document. A real
   connection needs a public HTTPS tunnel, which is an operational step, not a code control.
7. **The wallet's 48 hour session expiry is not tracked.** Olai finds out when a `baw` call
   fails.
8. **The real MCP tool names were unconfirmed when this was written.** `src/mcp/toolmap.ts`
   resolves them by keyword against whatever `tools/list` returns, with no confirmed live tool
   list saved in the repository. A mismatch surfaces as an error at connect time or a shape error
   on a bad response, not as a silently wrong trade, but the mapping itself is unverified.
9. **Two OAuth routes are public by design.** `/oauth/client-metadata.json` and
   `/oauth/callback` stay open because Binance fetches the first and redirects to the second;
   the callback is protected by the PKCE state match. `/oauth/start`, `/oauth/status` and
   `/oauth/disconnect` take the owner token.
10. **The token file mode is a no-op on Windows.** The OAuth token file is written with mode
    0600, but NTFS ignores POSIX bits, so on a Windows host any process running as the same user
    can read it. ATTACK-11 records this as NOT BLOCKED on this machine; a Linux host gets the
    0600 the code asks for. Locking the file with NTFS ACLs is a follow-up.
11. **The owner token lives in browser session storage for the life of the tab.** A compromised
    browser extension on the owner's machine could read `sessionStorage` the same as the desk's
    own code does. Nothing in the desk defends against that; the mitigation is the sub-account's
    own limits and the rulebook, not the desk itself.
12. **A compromised trading key could still trade.** `BINANCE_API_KEY`/`BINANCE_API_SECRET` carry
    no withdrawal permission, but whoever holds both could trade on the sub-account up to its
    balance and pay trading fees on every order, though never withdraw (`src/exchange/rest.ts`).

## 7. Self-audit statement

This threat model is self-audited by the project's own builder, reading every file under
`packages/agent/src` line by line against the running rulebook, ledger, session and x402 code,
plus Binance's Agent OS documentation. No external security firm and no automated
static-analysis tool has reviewed this code as of this writing.

What would change with a third-party audit: independent verification that the rulebook engine's
refusal logic cannot be bypassed by an input shape not considered here, a timing analysis of the
token compare beyond the constant-time hash compare already in place, a review of the subprocess
boundary in `src/x402/baw.ts` beyond the no-shell, argument-array mitigation already coded, and a
live penetration test of the OAuth flow against Binance's actual authorization server rather than
against the code path alone.
