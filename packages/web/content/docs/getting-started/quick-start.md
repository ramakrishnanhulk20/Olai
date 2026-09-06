---
title: Quick start
sidebar_position: 1
description: Clone Olai, fill in .env, connect the Binance MCP server and the Agentic Wallet, and fund both sides.
---

# Quick start

Everything on this page is read from the repository: `.env.example` in the root,
Binance's Agentic Wallet documentation and `packages/agent/src/config.ts`.

You need Node 22 or newer. The repository pins it in `.nvmrc`.

## 1. Clone and install

```bash
git clone <your fork of this repository> olai
cd olai
npm install
```

`npm install` installs the whole workspace. The agent lives in `packages/agent`.

## 2. Fill in .env

```bash
cp .env.example .env
```

Every key is read once at boot by `loadConfig` in `packages/agent/src/config.ts`, and Olai
refuses to start if one is wrong. Two keys have no default and you have to supply them.

| Key | What to put in it |
|---|---|
| `ANTHROPIC_API_KEY` | A key from console.anthropic.com. This is the agent's brain. |
| `OLAI_OWNER_TOKEN` | A secret you invent. It has to start with `ol.` and be at least 24 characters. Anyone holding it can approve trades. |

The rest have working defaults and are documented in `.env.example`:

| Key | Default | What it controls |
|---|---|---|
| `OLAI_PORT` | `4000` | The port the local service listens on. |
| `OLAI_DB_PATH` | `./data/olai.db` | The SQLite ledger file, relative to `packages/agent`. |
| `OLAI_RULEBOOK_PATH` | `./data/rulebook.json` | Where the rulebook is stored between runs. |
| `OLAI_WEB_ORIGIN` | `http://localhost:3000` | The one browser origin the API answers. |
| `OLAI_TRUST_PROXY` | `false` | Only `true` behind a proxy that rewrites `X-Forwarded-For`. |
| `OLAI_EXCHANGE` | `auto` | `auto` picks the REST API when a key is set, else the MCP session when a token exists, else the stand-in; `rest`, `mcp` and `fake` force one door. |
| `BINANCE_API_KEY` | none | A trade-only HMAC key on an isolated sub-account. Required for the REST door. |
| `BINANCE_API_SECRET` | none | The secret shown once when the key is created. Only ever used to sign a request, never logged. |
| `BINANCE_API_ENV` | `testnet` | `testnet` for `https://testnet.binance.vision`, `prod` for `https://api.binance.com`. |
| `OLAI_DRY_RUN` | `true` | `true` plans trades and payments but sends nothing. |
| `BINANCE_MCP_URL` | `https://agent.binance.com/mcp/agentic` | Binance's hosted MCP server, used only when `OLAI_EXCHANGE=mcp`. |
| `OLAI_PUBLIC_BASE_URL` | `http://127.0.0.1:4000` | The public HTTPS address Binance fetches Olai's client metadata from. |
| `OLAI_TOKEN_PATH` | `./data/binance-mcp-token.json` | Where the Binance sign-in token is written, owner-only. |
| `OLAI_CLIENT_NAME` | `Olai` | The name shown on the Binance consent screen. |
| `BAZAAR_BASE_URL` | `https://www.binance.com/bapi/ramp/v1/public/ramp/b402` | The B402 Bazaar. |
| `OLAI_PROVE_SPEND` | `no` | Only `yes` lets `npm run prove` spend real money, and only when `OLAI_DRY_RUN=false`. |

Leave `OLAI_DRY_RUN=true` until you have read [Dry run versus live](../guides/dry-run-versus-live.md).

> **You can stop here.** With those two keys and the free testnet key from the next step, everything
> except the money already works: the desk at `/app`, a whole question answered end to end in a dry
> run against real Binance spot testnet prices, the rulebook enforced in code, the ledger and its
> hash chain, and these docs. Run `npm run dry-run -w @olai/agent` now and read what it prints.
> Sections 5 onwards are what it takes to buy data with a real cent and place a real order: they
> need the Agentic Wallet, the Binance mobile app for a sign-in, and two separate fundings.

## 3. Get a Binance API key (the exchange door)

This is the door Olai actually trades through. Sign in at
`https://testnet.binance.vision` with GitHub and generate an HMAC key: it spends nothing real, and
it is the fastest way to see Olai place a live order. Put the key and secret in `.env` as
`BINANCE_API_KEY` and `BINANCE_API_SECRET`, and leave `BINANCE_API_ENV=testnet`.

For real money later, make a sub-account, give its key **Enable Spot Trading only**, leave
withdrawals off, and restrict it to this machine's IP, then set `BINANCE_API_ENV=prod`. Olai
signs every request with this key (`packages/agent/src/exchange/rest.ts`, `sign.ts`); the secret
itself never leaves the process as anything but an HMAC signature.

## 4. The Binance MCP server, held for now

Olai can also connect as its own MCP client (`packages/agent/src/mcp`), and the code for it is
complete and tested. It is not usable today: Binance's authorization-server metadata advertises
client-id-metadata-document clients, Olai's own OAuth client reached the consent page by that
published spec, and the page answered "The AI Agent you are using is not currently supported.
Please connect using a supported Agent to continue. (3346001-e450fe8d)". The allowlist admits only
Binance's own agents (Claude Code, Codex, ChatGPT, VS Code, Grok) today, so skip this section
until Binance opens the door, or read [The MCP client](../developers/mcp-client.md) out of
curiosity.

There is a path that does not involve Olai's own client at all, and it is the one Binance
documents for its own users. It is worth running once to prove
your account can trade through the MCP server, since it goes through Binance's own allowlisted
agent rather than Olai's:

```bash
claude mcp add binance-mcp-server --transport http https://agent.binance.com/mcp/agentic
```

No withdrawal scope exists on this server, same as the exchange API key above. The agent can read
markets, read balances, trade, and move money inside the sub-account, and it can never take money
off Binance.

## 5. Connect the Agentic Wallet

The `baw` CLI drives Olai's on-chain wallet. Olai holds no key material itself: every wallet
call goes through the CLI (`packages/agent/src/x402/baw.ts`). The commands below are the exact
ones a first sign-in produces.

Install the skill and the CLI:

```bash
npx skills add binance/binance-skills-hub/skills/binance-web3/binance-agentic-wallet
npm install -g @binance/agentic-wallet@1.9.0
```

The CLI does not install itself with the skill. Check both versions:

```bash
baw --version
baw cli-check --required-version 1.9.0 --json
baw skill-check --skill-name binance-agentic-wallet --current-version 1.11.0 --json
```

Sign in. This is two commands, not one, and the second one waits for your phone:

```bash
baw auth signin --json
baw auth verify --qrCodeId <qrCodeId from the previous command> --json
```

`auth signin --json` prints `urlForWeb`, `qrCodeId`, `expireAt` and a `pairingCode`. Open the URL,
scan it with the Binance app, and check the pairing code on screen matches the one the CLI
printed. `auth verify` blocks for up to five minutes until you approve.

Then confirm, and read the address you will fund:

```bash
baw wallet status --json
baw wallet address --json
baw wallet settings --json
```

`wallet status` is the source of truth, not the app's success screen. The session lasts 48 hours.
Olai does not track that expiry: it finds out when a `baw` call fails.

## 6. Fund both sides

Olai spends from two separate pots and neither can refill itself.

**The sub-account, for trading.** The agent cannot pull funds from your main Binance account.
You transfer them by hand in the Binance web interface: Profile, Dashboard, Sub-account, Asset
Management, Transfer. Roughly 50 to 100 USDT is enough for the small orders the starter rulebook
allows.

**The Agentic Wallet, for data.** Send about 5 USDT or USD1 on BNB Smart Chain to the address
`baw wallet address` printed. USD1 and U on BSC are signable straight away. USDT on BSC works
too but needs a one-time Permit2 approval first, with gas sponsored, which is one extra
transaction before the first payment settles.

Set the wallet's limits in the Binance app, not here. `wallet settings` is read only. The setting
that governs Olai is `x402DailyLimit`, and it is independent of the general daily limit. On the
spike machine it read 20 dollars with 20 left.

## 7. Check it boots

```bash
npm run dry-run -w @olai/agent -- "Should I trim my BNB position before the weekend?"
```

That is the next page: [First question](./first-question.md).
