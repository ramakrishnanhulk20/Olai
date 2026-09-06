# Olai: threat model

Written from the code as it exists in `packages/agent/src`. Routes under
`src/api` exist and are wired (see section 3), the rulebook engine, ledger, x402 buyer,
Bazaar client, the exchange REST client and the MCP client are all coded. Since the first
reading, `src/boot.ts` wires `createApp` and the OAuth routes to the
real dependencies and `src/index.ts` serves them. The owner's desk shipped too, at
`packages/web/src/app/app/page.tsx` with components under `packages/web/src/components/desk`; it
is covered as its own entry point in section 3, because a browser is a different kind of target
than a terminal calling curl directly.

Olai's exchange leg trades through Binance's exchange REST API on an isolated sub-account
(`src/exchange/rest.ts`), not through the Binance MCP server. Binance's authorization-server
metadata advertises client-id-metadata-document clients, and Olai's own OAuth client reached
the consent page by that published spec, but the page answered "The AI Agent you are using is
not currently supported. Please connect using a supported Agent to continue.
(3346001-e450fe8d)": the allowlist admits only Binance's own agents today. The MCP client in
`src/mcp` stays coded and tested, held unused, selectable by `OLAI_EXCHANGE=mcp` should
Binance open the door.

## 1. Assets

What an attacker could take or break, and why each one matters.

- **The Agentic sub-account funds.** The Binance sub-account Olai trades on
  (`src/exchange/rest.ts`, `src/mcp/exchange.ts`, `src/ports/exchange.ts`). The key has no
  withdrawal permission, but an attacker who can place orders can still lose the owner money on
  bad trades or waste it on fees.
- **The Binance API key and secret.** `BINANCE_API_KEY` and `BINANCE_API_SECRET`
  (`src/config.ts`), used only to build the HMAC signature in `src/exchange/sign.ts`
  (`buildSignedQuery`). The secret itself never appears in a request, a log line, or a URL
  parameter, only as the resulting signature; the key is logged masked
  (`src/exchange/rest.ts`, `maskKey`). Whoever holds both can trade on the sub-account up to
  its balance, though never withdraw.
- **The Agentic Wallet funds and its 48 hour session.** The on-chain wallet the `baw`
  CLI drives for x402 payments (`src/x402/baw.ts`). The wallet's own sign-in session
  (per `binance-agentic-wallet` skill docs, `reference/skills-hub-repo`) is time-boxed;
  Olai holds no keys itself, only calls the CLI.
- **The Binance MCP OAuth token file.** `OLAI_TOKEN_PATH` (default
  `./data/binance-mcp-token.json`), written and read by `src/mcp/oauth.ts`
  (`BinanceOAuth.save`/`load`). Whoever holds this file can act as Olai against the
  live MCP server until Binance's token expires or is revoked.
- **The owner token.** `deps.ownerToken` checked in `src/api/auth.ts` (`ownerAuth`,
  `sameToken`). Whoever holds this bearer token can write the rulebook, ask questions,
  approve orders, and hit kill/resume through every `/api/*` route in `src/api/app.ts`.
- **The Anthropic API key.** `ANTHROPIC_API_KEY`, read once in `src/config.ts`
  (`loadConfig`) and used to construct the `Anthropic` client passed into
  `runAnalyst` (`src/brain/analyst.ts`). A leaked key lets someone spend the owner's
  Anthropic budget or impersonate the brain's requests.
- **The ledger's integrity.** The hash-chained SQLite file in `src/ledger/ledger.ts`
  and `src/ledger/hash.ts`. This is the one audit trail of every decision, payment and
  order; if it can be silently edited, nothing else Olai claims is provable.
- **The owner's decisions.** The rulebook (`src/policy/rulebook.ts`,
  `src/rulebook/store.ts`) and every approve/reject/kill/resume act
  (`src/session/session.ts`). An attacker who can forge an approval or edit a rulebook
  file undetected has taken over what the owner believes they control.

## 2. Attackers

- **A prompt-injecting merchant.** Every Bazaar listing and every 402 response body is
  untrusted text the model reads (`src/brain/analyst.ts` tool results, `src/x402/buyer.ts`
  `readBody`). A merchant can put instructions in its `description` or its JSON payload
  hoping the model acts on them instead of on the rulebook.
- **A malicious or compromised Bazaar listing.** `src/bazaar/client.ts` parses the
  public, unauthenticated Bazaar search/list endpoints with zod schemas
  (`resourceSchema`, `acceptSchema`) but the `description` and `url` fields themselves
  are free text from whoever listed the resource.
- **Someone on the local network, or anyone who has the desk's URL and no token.**
  Every `/api/*` route requires the owner bearer token (`ownerAuth` in
  `src/api/auth.ts`); the risk is a leaked URL, a shared screen, or a network peer
  trying without the token.
- **A stolen laptop.** Whoever has filesystem access to `OLAI_TOKEN_PATH`,
  `OLAI_DB_PATH`, and the rulebook JSON file gets the MCP session, the whole ledger,
  and the current rulebook, though not the owner token or the Anthropic key, which live
  only in environment variables per `src/config.ts` and are not written to disk by
  Olai.
- **A bug in our own code.** A schema that is too loose, a race in the ledger's
  sequence numbering, or a tool-name mismatch in `src/mcp/toolmap.ts` that silently
  routes a call to the wrong tool.
- **The model itself acting outside the rulebook.** Claude proposing an order or a
  payment that ignores the rulebook it was told about in `staticSystemText`
  (`src/brain/analyst.ts`). The design assumes the model will sometimes try; the
  defense is that its output is checked in code, never trusted as a decision.

## 3. Entry points

| Entry point | Where in code | What reaches it |
|---|---|---|
| The desk in the browser | `packages/web/src/app/app/page.tsx`, `packages/web/src/components/desk/*` | The owner's own browser tab, nothing else. Gated by the owner token, typed once into `gate.tsx` and held in `sessionStorage` under the key `olai.owner-token`; read straight into the `Authorization` header on every call (`packages/web/src/lib/api.ts`, `packages/web/src/lib/sse.ts`) and never placed in a URL, a cookie, a React key, or a log. A 401 from any call clears the token and drops back to the gate. Every route it calls is one of the rows below, reached only from `OLAI_WEB_ORIGIN` (CORS in `src/api/app.ts`). The landing page at `/` (`packages/web/src/app/page.tsx`) is a different, unauthenticated surface: it reads only the public `GET /health` and a ledger sequence the owner exported ahead of time to `packages/web/public/ledger-sample.json`; it holds no token at all |
| `GET /health` | `src/api/app.ts` | Public, no auth, returns `ok`, `dryRun`, `killed`, `version` only |
| `GET /api/rulebook`, `PUT /api/rulebook` | `src/api/app.ts` | Owner token required (`ownerAuth`); body validated by `rulebookSchema` in `src/policy/rulebook.ts` via `RulebookStore.save` |
| `POST /api/ask` | `src/api/app.ts` (`askSchema`) | Owner token; runs `SessionRunner.ask` -> `runAnalyst`, the only entry that spends Anthropic tokens and can trigger `buy_data` |
| `GET /api/sessions`, `GET /api/sessions/:id` | `src/api/app.ts` | Owner token; read-only, in-memory `SessionRunner` state |
| `POST /api/sessions/:id/approve` | `src/api/app.ts` | Owner token; the one path that can place a real order (`SessionRunner.approve`) |
| `POST /api/sessions/:id/reject` | `src/api/app.ts` (`rejectSchema`) | Owner token |
| `POST /api/kill`, `POST /api/resume` | `src/api/app.ts` | Owner token; flips `SessionRunner.killed` |
| `GET /api/ledger`, `GET /api/ledger/verify` | `src/api/app.ts` (`ledgerQuerySchema`) | Owner token; read-only, `Ledger.list`/`verifyChain` |
| `GET /api/account` | `src/api/app.ts` | Owner token; `AccountStateSource.snapshot` |
| `GET /api/wallet` | `src/api/app.ts` | Owner token; proxies `Baw.walletStatus`/`walletSettings`/`walletBalance` |
| `GET /api/bazaar/search` | `src/api/app.ts` (`searchQuerySchema`) | Owner token; proxies `BazaarClient.search` |
| `GET /api/events` (SSE) | `src/api/app.ts` | Owner token; `EventHub` broadcast, capped at 16 concurrent streams |
| OAuth: `GET /oauth/client-metadata.json`, `GET /oauth/start`, `GET /oauth/callback`, `GET /oauth/status`, `POST /oauth/disconnect` | `src/mcp/oauth.ts` (`oauthRoutes`) | No owner-token middleware is applied to these in the code read; they sit outside the `/api/*` prefix that `ownerAuth` guards in `src/api/app.ts`. `client-metadata.json` is meant to be public (Binance fetches it). `/oauth/callback` is protected by the PKCE `state` check, not a bearer token. Mounted by `src/boot.ts` on the same app as the owner API. |
| Client metadata document | `src/mcp/oauth.ts` (`clientMetadata()`) served at `${publicBaseUrl}/oauth/client-metadata.json`; must be publicly reachable over HTTPS for Binance's OAuth server to fetch it |
| The `baw` CLI subprocess | `src/x402/baw.ts` (`execa('baw', args, ...)`) | Runs with `reject: false`, no shell, arguments passed as an array (not a shell string), timeout 120s |
| Merchant HTTP responses | `src/x402/buyer.ts` (`send`, `readBody`), `src/x402/paymentRequired.ts` (`decodePaymentRequired`, `decodeSettlement`) | Untrusted network responses, parsed through zod (`paymentRequiredSchema`, `acceptSchema`) before use |
| Binance exchange REST API | `src/exchange/rest.ts` (`BinanceRestExchange`) | Signed GET `/api/v3/account` and `/api/v3/order`, signed POST `/api/v3/order` (market orders by `quoteOrderQty`, `newClientOrderId` equal to the session id), and public GET `/api/v3/ticker/24hr`, `/api/v3/depth`, `/api/v3/klines`, `/api/v3/exchangeInfo`. The secret only ever appears as an HMAC signature (`src/exchange/sign.ts`); the key is logged masked |
| Claude API responses | `src/brain/analyst.ts` (`runAnalyst`, tool loop) | The model's own tool calls and its final `propose` call, constrained by `proposalSchema` in `src/brain/proposal.ts` |
| The SQLite ledger file | `src/ledger/ledger.ts` | `OLAI_DB_PATH`; append-only via SQL triggers, read by anyone with filesystem access |
| The rulebook file | `src/rulebook/store.ts` | Plain JSON on disk, no encryption; anyone with filesystem access can read or edit it, though an edit is only trusted if it re-parses under `rulebookSchema` |
| `.env` | `src/config.ts` (`loadConfig`) | Read once at boot; holds `ANTHROPIC_API_KEY` and every other setting |

## 4. Controls, mapped to code

- **The exchange key never appears as itself.** `src/exchange/sign.ts` (`buildSignedQuery`)
  turns every signed request into a query string plus an HMAC-SHA256 signature computed from
  `BINANCE_API_SECRET`; the secret itself is never sent, logged, or placed in a URL parameter.
  `src/exchange/rest.ts` (`maskKey`) logs the API key masked in the one line printed at
  construction. A POST that places an order is never retried on a lost answer: `placeOrder`'s
  `recover` callback asks Binance what happened by `newClientOrderId` (the session id) instead
  of sending a second order.

- **The rulebook engine.** `src/policy/engine.ts`, function `evaluate(rulebook, action,
  state)`. It is a pure function (no clock read, no database read) that returns a
  `Verdict`. It is called in three places, always before anything moves:
  1. `src/brain/analyst.ts`, inside the `buy_data` tool's `run`, before `deps.data.buy`
     is ever called (checks a `payment` action).
  2. `src/session/session.ts`, `SessionRunner.ask`, right after a proposal comes back,
     before the owner sees a pending order.
  3. `src/session/session.ts`, `SessionRunner.approve`, checked again against a fresh
     `accountState()` snapshot, before `deps.exchange.placeOrder` is called.
  The rulebook itself is validated by `rulebookSchema` in `src/policy/rulebook.ts`
  before it is ever saved (`RulebookStore.save`), and `evaluate` also re-checks the
  rulebook's shape at runtime (`rulebookLooksReal`) and refuses everything if it does
  not look real.

- **The ledger hash chain and its SQL triggers.** `src/ledger/hash.ts`
  (`hashEntry`, `canonicalJson`, `GENESIS_PREV_HASH`) and `src/ledger/ledger.ts`
  (`Ledger.append`, `Ledger.verifyChain`). Every line's hash covers the previous line's
  hash plus its own canonical JSON, so editing an old line breaks every later hash.
  `verifyChain()` walks the whole table and returns the first broken `seq`. The
  `ledger_no_update` and `ledger_no_delete` SQL triggers (in the `SCHEMA` constant)
  make UPDATE and DELETE raise `RAISE(ABORT, ...)` at the database level, so tampering
  must go around SQLite entirely (edit the file bytes directly), which `verifyChain`
  is built to catch.

- **The one-signature-per-paymentId guard.** `src/x402/buyer.ts` requires two hooks,
  `alreadySigned` and `markSigned`, and `src/ports/data.ts` (`ledgerSignatureGuard`)
  backs them with the ledger: a `payment.signed` line is appended before
  `opts.baw.x402Sign` is called, so a thrown signature still counts as used, and a repeat
  `buy()` for the same `paymentId` returns `{ status: 'failed', reason: 'this payment was
  already signed once...' }` without calling the wallet again. Because the claim is a
  ledger line, it survives a restart (executed as ATTACK-04).

- **The dry-run flag.** `OLAI_DRY_RUN` (`src/config.ts`, default `true`). Threaded
  through: `src/brain/analyst.ts` (`staticSystemText` tells the model buy_data will
  price but not pay), `src/x402/buyer.ts` (`buy()` returns `status: 'dry-run'` before
  calling `x402Sign`), and `src/session/session.ts` (`SessionRunner.approve` writes an
  `order.sent` line marked `dryRun: true` and never calls `exchange.placeOrder`).

- **The kill switch.** `src/session/session.ts`, `SessionRunner.kill()`/`resume()`,
  backed by a private `killed` boolean. `SessionRunner.state()` always ORs the local
  `killed` flag over whatever `accountState()` returns, so a stale account read can
  never un-kill the agent. `evaluate()` in `src/policy/engine.ts` refuses everything
  (`ruleIds.killed`) the instant `state.killed === true`. Kill does not cancel an order
  already in flight (see gap 6.5).

- **The owner token prefix and constant-time compare.** `src/api/auth.ts`,
  `OWNER_TOKEN_PREFIX = 'ol.'`, `assertOwnerToken` (checked at boot, refuses to start
  with a bad token), `MIN_TOKEN_LENGTH = 24`, and `sameToken()`, which sha256-hashes
  both sides before `timingSafeEqual` so tokens of different lengths still compare in
  constant time and the real token's length is not leaked by timing.

- **Rate limiting.** `src/api/auth.ts`, `rateLimit()`. A fixed window per client IP
  (`RATE_LIMIT_MAX = 60` requests per `RATE_LIMIT_WINDOW_MS = 60_000` ms), counted on
  `clientIp()`, which only trusts `X-Forwarded-For` when `trustProxy` is explicitly set
  and otherwise falls back to the raw socket address. Windows above `SWEEP_ABOVE =
  1024` tracked IPs are swept of expired entries on each request.

- **OAuth state and PKCE checks.** `src/mcp/oauth.ts`, `BinanceOAuth.startAuthorization`
  (mints a random `state` via `base64url(randomBytes(16))` and a PKCE verifier through
  the MCP SDK's `sdkStartAuthorization`), `handleCallback` (rejects on
  `query.error`, on no pending flow, on `query.state !== pending.state`
  ("state_mismatch"), and on a missing code). The RFC 8707 `resource` parameter pins
  the token to `cfg.mcpUrl` specifically.

- **Zod at every boundary.** Every external input is parsed before use: the API body
  and query schemas in `src/api/app.ts` (`askSchema`, `rejectSchema`,
  `ledgerQuerySchema`, `searchQuerySchema`), the Bazaar response schemas in
  `src/bazaar/client.ts`, the MCP tool-answer schemas in `src/mcp/exchange.ts`
  (`tickerFromTool`, `orderBookFromTool`, `balanceFromTool`, `positionFromTool`,
  `orderFromTool`), the `baw` CLI's JSON envelope in `src/x402/baw.ts`
  (`envelopeSchema`, `previewSchema`, `signSchema`), and the merchant's 402 payload in
  `src/x402/paymentRequired.ts` (`paymentRequiredSchema`, `acceptSchema`). Nothing
  from outside the process is used unparsed.

- **The desk adds a browser, so it is scoped like one.** `packages/web/src/app/app/page.tsx` and
  `packages/web/src/components/desk/*`. A script that ran inside the page could read
  `sessionStorage` the same as the desk's own code does, so the mitigation is in what the desk
  refuses to load or render, not in the storage API: no third-party script tag anywhere in the
  bundle (fonts are self-hosted through `next/font`), and nothing from the network is ever
  rendered through `dangerouslySetInnerHTML` or otherwise as HTML, only as text React itself
  escapes. The token lives in `sessionStorage`, not `localStorage`, so it dies when the tab closes
  rather than persisting across browser restarts (`packages/web/src/lib/token.ts`).
  `OLAI_WEB_ORIGIN` in `src/api/app.ts` is the only origin the API's CORS policy answers, so a
  page on any other site cannot get a browser to carry the token to it even if it talked the owner
  into visiting. The landing page at `/` (`packages/web/src/app/page.tsx`) is a separate,
  unauthenticated surface built to need no token at all: it reads only public `GET /health` and a
  ledger sequence the owner captured ahead of time into `packages/web/public/ledger-sample.json`,
  so there is nothing on it for a browser bug to leak.

- **Binance's own controls (outside Olai's code, relied upon).** From
  Binance's own documentation: no withdrawal scope exists for the MCP server;
  the Agentic sub-account is walled off from the owner's main account (the agent
  cannot pull funds in); the Agentic Wallet has a daily limit and a separate x402 daily
  limit set only in the Binance app (`wallet settings`, read in
  `src/x402/baw.ts`); wallet sends only go to addresses already in the app's address
  book; and the `binance-cli`/`baw` skills document a confirm-before-execute pattern
  for production transactions (Olai's own owner-approval gate in
  `src/session/session.ts` is the equivalent Olai implements itself, since Olai is
  not running inside Claude Code and so gets no external CONFIRM prompt).

## 5. Attack list for the next order

- ATTACK-1: prompt injection through a merchant response that tells the agent to buy
  10x the limit. Expected result: refused. Control: `evaluate()`'s `checkPayment`
  (`ruleIds.paymentPerCall`/`paymentDailyBudget`) and, for a resulting order,
  `checkOrder`'s `ruleIds.maxOrder`, both in `src/policy/engine.ts`, run in code
  regardless of what the model says.
- ATTACK-2: a proposal above `maxOrderUsd`. Expected result: refused before the owner
  ever sees it. Control: `SessionRunner.ask` calling `evaluate()` immediately after the
  proposal (`src/session/session.ts`).
- ATTACK-3: approving twice. Expected result: one order sent. Control:
  `SessionRunner.approve`'s early return when `record.status === 'executed' ||
  this.ordered.has(sessionId)`, and the `ordered` Set added to before the exchange call
  (`src/session/session.ts`).
- ATTACK-4: a replayed x402 signature. Expected result: refused the second time.
  Control: `signedPaymentIds` Set in `src/x402/buyer.ts`, claimed before signing.
- ATTACK-5: editing a ledger row directly in the SQLite file. Expected result:
  `GET /api/ledger/verify` reports the first broken `seq`. Control:
  `Ledger.verifyChain()` in `src/ledger/ledger.ts`, plus the `ledger_no_update`/
  `ledger_no_delete` triggers, which stop an in-process UPDATE/DELETE but not a
  raw file edit (that is exactly what verifyChain is for).
- ATTACK-6: forging the owner token by using a session id. Expected result: refused,
  401. Control: `sameToken()`'s constant-time hash compare in `src/api/auth.ts`, and
  the fact that session ids (`ol-<uuid>`) and the owner token (`ol.` prefix,
  `MIN_TOKEN_LENGTH`) live in disjoint namespaces on purpose.
- ATTACK-7: a rulebook with NaN. Expected result: refused at save time and, as a
  second line of defense, refused at evaluation time even if it somehow got saved.
  Control: `usd` refinement in `rulebookSchema` (`src/policy/rulebook.ts`) rejects a
  non-finite number at `RulebookStore.save`; `isCleanUsd()` in `src/policy/money.ts`
  and `rulebookLooksReal()` in `src/policy/engine.ts` are the runtime backstop.
- ATTACK-8: a symbol not in the allow list. Expected result: refused. Control:
  `checkOrder`'s `ruleIds.symbolNotAllowed` in `src/policy/engine.ts`.
- ATTACK-9: kill then approve. Expected result: refused. Control:
  `SessionRunner.state()` ORing the local `killed` flag, and `evaluate()`'s
  `ruleIds.killed` check, both in `src/policy/engine.ts`/`src/session/session.ts`.
- ATTACK-10: calling the API from a second IP past the rate limit. Expected result:
  the first IP gets 429 after 60 requests in the window; a genuinely different IP gets
  its own window. This is a known, stated limit of the control (a stated limit of the control, not a gap listed in section 6), not a bypass of the owner-token check.
- ATTACK-11: reading the token file's permissions. Expected result: on POSIX, mode
  `0600` (owner read/write only), set in `src/mcp/oauth.ts` (`TOKEN_FILE_MODE`,
  applied via `chmod` after every write, since `writeFile`'s mode option is only
  honored on file creation). On Windows this chmod is a no-op (caught and ignored;
  comment: "Windows has no POSIX permission bits. Nothing to tighten there."), so this
  attack should report that gap explicitly on a Windows host.
- ATTACK-12: grepping the repo and git history for secrets. Expected result: no
  `ANTHROPIC_API_KEY`, owner token, or Binance token committed. `.env.example` in the
  repo root carries only blank placeholders and instructive comments; the real `.env`,
  `OLAI_TOKEN_PATH`, and `OLAI_DB_PATH` are gitignored (verify this explicitly, not
  assumed, in the attack script).

## 6. Weaknesses we did not fix

1. `dailyLossUsd` is computed from equity snapshots (`src/account/state.ts`,
   `AccountStateSource.snapshot`, comparing `equityCents` against a recorded
   `dayStartEquityCents`), so it counts unrealized price moves on held positions as
   "loss" exactly the same as a realized loss from a bad trade. A held BNB position
   that merely drops in price today will trip `maxDailyLossUsd` and the drawdown tiers
   the same as an actual losing trade would.
2. In-memory session state (`SessionRunner.sessions`, `SessionRunner.ordered`) and the
   x402 one-signature-per-paymentId guard (`signedPaymentIds` in
   `src/x402/buyer.ts`) do not survive a process restart. A restart mid-approval loses
   the record of which sessions already ordered and which payment ids were already
   signed; the ledger is still the durable record of what actually happened, but the
   in-memory guards that prevent a double-send or a double-sign are gone until the
   process has run long enough to rebuild them.
3. The merchant response is trusted as data after schema validation only. Nothing in
   `src/x402/buyer.ts` or `src/brain/analyst.ts` strips or flags instruction-like text
   inside a merchant's `description` or JSON body before handing it to the model; the
   defense is entirely downstream, in the rulebook engine refusing whatever action the
   model proposes as a result.
4. The model writes `dataUsed` itself (`proposalSchema` in `src/brain/proposal.ts`).
   `runAnalyst`'s system prompt tells the model never to invent a cost or a hash, but
   nothing in code cross-checks the model's `dataUsed` entries against what the ledger
   actually recorded from `buy_data` calls in the same session.
5. No cancel of in-flight orders on kill. `SessionRunner.kill()`
   (`src/session/session.ts`) stops every future rulebook check from passing; it does
   not call `exchange.orderStatus` or any cancel path on an order already sent to
   Binance.
6. The public base URL for OAuth must be a tunnel in development.
   `OLAI_PUBLIC_BASE_URL` (`src/config.ts`) defaults to `http://127.0.0.1:4000`,
   which Binance's OAuth server cannot reach to fetch the client metadata document
   (`src/mcp/oauth.ts`, `clientMetadata()`); a real connection needs a public HTTPS
   tunnel, which is an operational step outside the code, not a code control.
7. The wallet's 48 hour session expiry (per the `binance-agentic-wallet` skill docs)
   is not tracked or refreshed anywhere in `src/x402/baw.ts`; Olai finds out only when
   a `baw` call fails.
8. Real tool names of the Binance MCP server were unconfirmed at the time of writing.
   `src/mcp/toolmap.ts` resolves tool names by keyword matching
   (`resolveToolMap`, `RULES`) against whatever `tools/list` returns at runtime, with no
   confirmed live tool list saved in this repo as of this reading. A mismatch would
   surface as a `ToolMapError` at connect time or an `ExchangeShapeError` on a bad
   response shape, not as a silently wrong trade, but the mapping itself is unverified.
9. The OAuth routes (`src/mcp/oauth.ts`, `oauthRoutes`) are mounted by `src/boot.ts`.
   `/oauth/start`, `/oauth/status` and `/oauth/disconnect` sit behind the owner token;
   `/oauth/client-metadata.json` and `/oauth/callback` stay public because Binance fetches
   the first and redirects to the second, and the callback is protected by the PKCE
   `state` match rather than a bearer token.
10. On a Windows host the Binance token file is written with mode 0600, but NTFS ignores
    POSIX bits, so the file is readable by any process running as the same user. Attack
    ATTACK-11 records this as NOT BLOCKED on this machine. A Linux host gets the 0600 the
    code asks for. Locking the file with NTFS ACLs is a follow-up.
11. The owner token lives in browser session storage for the life of the tab
    (`packages/web/src/lib/token.ts`). A compromised browser extension on the owner's machine
    could read it the same as the desk's own code does. Nothing in the desk defends against that;
    the mitigation is the sub-account's own limits and the rulebook, not the desk itself.
12. A compromised `BINANCE_API_KEY`/`BINANCE_API_SECRET` pair could trade on the sub-account
    up to its balance, buying or selling at will and paying trading fees on every order, though
    it could never withdraw: the key carries Enable Spot Trading only, no withdrawal permission
    (`src/exchange/rest.ts`).

## 7. Self-audit statement

This threat model is self-audited by the project's own builder cook, reading every
file under `packages/agent/src` line by line against the running rulebook, ledger,
session, and x402 code, plus Binance's Agent OS documentation. No
external security firm, and no automated static-analysis tool (Slither, Semgrep, or
similar), has reviewed this code as of this writing. What would change with a
third-party audit: independent verification that the rulebook engine's refusal logic
cannot be bypassed by an input shape not considered here, a timing analysis of
`sameToken()` beyond the constant-time hash compare already in place, a review of the
`execa` subprocess boundary in `src/x402/baw.ts` for anything beyond the "no shell,
argument array" mitigation already coded, and a live penetration test of the OAuth flow
against Binance's actual authorization server rather than against the code path alone.
