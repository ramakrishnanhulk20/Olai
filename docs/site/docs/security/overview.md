---
title: Security overview
sidebar_position: 1
description: What Olai can and cannot do with your money, and where the detail lives.
---

# Security overview

Olai is an agent that spends money. Two kinds: cents on data through the Agentic Wallet, and
dollars on orders through a Binance sub-account. This page is the short version of what stops it.

## The one sentence

The model advises, the rulebook decides, the owner approves, and the ledger proves it.

## What Olai can do

- Read markets and the sub-account through the Binance MCP server.
- Search the public B402 Bazaar.
- Pay a Bazaar merchant over x402, once per priced call, inside a per-call cap and a daily
  budget.
- Propose one action per question.
- Place one spot order per session, after an explicit owner approval, inside the rulebook.

## What Olai cannot do

- **Withdraw from Binance.** No withdrawal scope exists on the MCP server.
- **Fund itself.** It cannot pull money from the owner's main account into the sub-account.
- **Hold a key.** Wallet signing goes through the `baw` CLI. Olai holds no key material.
- **Raise its own limits.** The wallet's daily limits are set only in the Binance app, and the
  rulebook clamps whatever budget the model asks for.
- **Place an order by itself.** The model has no order tool. Only the session runner has one, and
  only after an owner approval that arrived as an authenticated HTTP call.
- **Use leverage.** `allowLeverage` is a literal `false` in the schema, not a setting.
- **Quietly edit its own record.** The ledger is append only at the database level and hash
  chained.

## The four layers

1. **The rulebook**, a pure function in `packages/agent/src/policy/engine.ts`, checked before
   every payment and twice before every order.
2. **The ledger**, hash chained, with SQL triggers that refuse UPDATE and DELETE.
3. **The kill switch**, ORed over every account read so a stale read cannot un-kill it.
4. **Binance's own controls**: no withdrawal scope, a walled sub-account, wallet daily limits set
   only in the app, an address book for sends, and a 48 hour wallet session.

[Trust model](../concepts/trust-model.md) explains each one with the code that implements it.

## The boundary rules

- One user, one bearer token, its own `ol.` namespace, compared in constant time, checked at boot.
- 60 requests a minute per address, counted on something the caller cannot choose.
- 64 KB body limit, one named browser origin in CORS.
- Every external input parsed with a schema before use: API bodies, Bazaar responses, MCP tool
  answers, the wallet CLI's output, and merchant 402 payloads.
- Secrets live in `.env` and in environment variables. `.env` is git-ignored, `.env.example`
  carries blank placeholders and comments only.
- Errors tell the caller what they did wrong and nothing else. An unexpected error is a flat 500,
  because a stack trace in an HTTP body is a map of the machine.

## Where the detail is

- [Threat model](./threat-model.md): the assets, the attackers, every entry point, the controls
  mapped to code, and the ten weaknesses we did not fix.
- [Audits](./audits.md): who reviewed this, how, and where the executed attack output lives.

## If you find something

The gaps we already know about are listed in section 6 of the threat model, in plain language,
including the ones that are awkward to admit. If you find one that is not on that list, open an
issue on the repository with the file and the line. A security report that names a file is worth
ten that describe a feeling.
