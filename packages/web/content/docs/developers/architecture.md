---
title: Architecture
sidebar_position: 1
description: The system overview, the main sequence and the module dependency graph, copied from ARCHITECTURE.md.
---

# Architecture

The three diagrams below are the ones in `ARCHITECTURE.md` at the repository root, unchanged.
The module graph is drawn from the real `import` lines in `packages/agent/src`.

## System overview

```mermaid
flowchart LR
    Owner["Owner's browser"]

    subgraph Olai["Olai service"]
        API["Owner API<br/>Hono routes"]
        Runner["Session runner"]
        Brain["Brain<br/>Claude tool loop"]
        Rules["Rulebook engine<br/>pure function"]
        Ledger["Ledger<br/>SQLite, hash chained"]
    end

    ClaudeAPI["Claude API"]
    BazaarClient["Bazaar search client"]
    BazaarCatalog["B402 Bazaar<br/>public search, no auth"]
    Wallet["Binance Agentic Wallet<br/>baw CLI"]
    Merchants["Bazaar merchants<br/>Nansen, CoinMarketCap"]
    Exchange["Binance exchange REST API<br/>sub-account, live door"]
    Mcp["Binance MCP server<br/>closed today: allowlist"]

    Owner -->|"HTTPS, owner bearer token: ask a question, edit rulebook, approve or reject, kill or resume"| API
    API -->|"SSE: thinking, tool calls, proposals, ledger lines"| Owner

    API --> Runner
    Runner --> Brain
    Runner --> Rules
    Runner --> Ledger
    Brain --> Ledger

    Brain -->|"tool loop over HTTPS, streaming, adaptive thinking"| ClaudeAPI
    ClaudeAPI -->|"tool calls, thinking deltas, final proposal"| Brain

    Brain -->|"search query, price cap"| BazaarClient
    BazaarClient -->|"GET bazaar search, no auth"| BazaarCatalog
    BazaarCatalog -->|"resource list: url, price, accepted tokens"| BazaarClient

    Brain -->|"rulebook check before every payment"| Rules

    Brain -->|"baw x402-payment preview and sign, CLI subprocess"| Wallet
    Wallet -->|"signed payment header, approve tx hash if needed"| Brain

    Brain -->|"paid HTTP call with signed x402 header"| Merchants
    Merchants -->|"requested data plus settlement header with tx hash"| Brain

    Brain -->|"free reads: ticker, order book, klines, balances, HMAC signed"| Exchange
    Runner -->|"rulebook check before every order, place order after owner approval"| Rules
    Runner -->|"place order, HMAC-signed REST call, client order id = session id"| Exchange
    Exchange -->|"balances, ticker, order book, klines, order result"| Runner

    Runner -.->|"closed today: allowlist"| Mcp
```

## Main sequence

One question, end to end, on a live order.

```mermaid
sequenceDiagram
    participant Owner
    participant API as Owner API
    participant Runner as Session runner
    participant Brain as Brain, Claude tool loop
    participant Rules as Rulebook engine
    participant Bazaar as B402 Bazaar
    participant Wallet as Agentic Wallet, baw CLI
    participant Merchant as Bazaar merchant
    participant Exchange as Binance exchange API, sub-account
    participant Ledger as Ledger, hash chained

    Owner->>API: POST /api/ask, question
    API->>Runner: ask(question)
    Runner->>Brain: run analyst
    Brain->>Ledger: append question

    Brain->>Bazaar: search_bazaar, query and price cap
    Bazaar-->>Brain: payable resources with prices
    Brain->>Ledger: append discovery

    Brain->>Rules: evaluate payment action
    Rules-->>Brain: verdict, allowed or refused
    Brain->>Ledger: append payment.preview

    Brain->>Wallet: x402-payment preview
    Wallet-->>Brain: signable options, ranked
    Brain->>Wallet: x402-payment sign
    Wallet-->>Brain: signed payment header

    Brain->>Merchant: paid call with signed x402 header
    Merchant-->>Brain: data plus settlement header with tx hash
    Brain->>Ledger: append payment.settled, cost and tx hash

    Brain->>Exchange: ticker, order book, klines
    Exchange-->>Brain: live market data
    Brain->>Ledger: append note per read

    Brain->>Brain: propose action
    Brain->>Ledger: append proposal
    Brain-->>Runner: proposal

    Runner->>Rules: evaluate order against rulebook
    Rules-->>Runner: verdict, requires approval
    Runner->>Ledger: append proposal or rule.refused
    Runner-->>API: pending session
    API-->>Owner: proposal shown, waiting

    Owner->>API: POST /api/sessions/:id/approve
    API->>Runner: approve(id)
    Runner->>Rules: re-evaluate order, fresh account state
    Rules-->>Runner: verdict, allowed
    Runner->>Ledger: append approval

    Runner->>Exchange: signed order, newClientOrderId = session id
    Exchange-->>Runner: order result, filled
    Runner->>Ledger: append order.sent then order.filled
    Runner-->>API: executed session
    API-->>Owner: fill shown, ledger updated
```

## Module dependency graph

Arrows drawn from the real `import` lines in `packages/agent/src`, read with grep rather than
by hand. Direction is "depends on".

```mermaid
flowchart TD
    config["config"]
    ledger["ledger"]
    policy["policy"]
    bazaar["bazaar"]
    x402["x402"]
    ports["ports"]
    brain["brain"]
    session["session"]
    mcp["mcp"]
    exchange["exchange"]
    account["account"]
    rulebook["rulebook"]
    api["api"]

    account --> ledger
    account --> policy
    account --> ports

    rulebook --> ledger
    rulebook --> policy

    x402 --> bazaar

    ports --> bazaar
    ports --> x402

    mcp --> ports
    exchange --> ports

    brain --> ledger
    brain --> policy
    brain --> ports

    session --> brain
    session --> ledger
    session --> policy
    session --> ports

    api --> account
    api --> bazaar
    api --> ledger
    api --> rulebook
    api --> session
    api --> x402

    config -.->|"index.ts reads config at boot, does not yet wire in api or session, see note below"| api
```

Note on that last dashed arrow: as the code stands, `src/index.ts` only loads config and
serves a bare `/health` stub. It does not import `api/app.ts`, `session/session.ts`, or
`mcp/client.ts` yet, so the real owner API in `api/app.ts` is not wired into the running process.
`policy` and `ledger` are the two modules with no outgoing edges; they import nothing else in
`src`. `exchange` depends only on `ports` (for shared types) and is otherwise self-contained
across its own three files (`rest.ts`, `schemas.ts`, `sign.ts`); it is the door actually open,
because Binance's MCP consent screen refuses Olai's own OAuth client today. `mcp` depends only
on `ports` (for shared types) and is otherwise self-contained across its own four files
(`client.ts`, `exchange.ts`, `oauth.ts`, `toolmap.ts`); it is coded and tested but held unused
until Binance admits third-party agents.

That note records the state of `ARCHITECTURE.md` when the graph was drawn. `src/boot.ts` has
since been added, and it is what builds the service the way the diagram shows: it constructs the
ledger, the rulebook store, the account state source, the wallet wrapper, the exchange and the
session runner, mounts `oauthRoutes` and `createApp` on one Hono app, and `src/index.ts` serves
it. When the diagram and the code disagree, the code wins. Read `packages/agent/src/boot.ts`.

## Repository layout

```
packages/agent/src
  api/        the owner API, auth, errors, the event hub
  account/    equity, daily loss and data spend, read from the exchange and the ledger
  bazaar/     the B402 Bazaar client and its token tables
  brain/      the Claude tool loop and the proposal schema
  exchange/   the exchange REST client: HMAC signing, schemas, the live trading door
  ledger/     the hash chain, canonical JSON, the SQLite store
  mcp/        OAuth, the MCP session, the tool-name map, the exchange adapter (coded, held unused)
  policy/     the rulebook shape, the money helpers, the rulebook engine
  ports/      the interfaces the rest of the code depends on, plus fakes
  rulebook/   reading and writing the owner's rulebook file
  session/    the session runner, the only thing that can place an order
  x402/       the wallet wrapper, the buyer, the 402 decoders, merchant builders
packages/agent/scripts
  dry-run.ts, prove.ts, probe-bazaar.ts
docs/site     this documentation site
```
