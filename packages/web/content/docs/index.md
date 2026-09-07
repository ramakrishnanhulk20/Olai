---
slug: /
title: Olai
sidebar_label: Overview
sidebar_position: 1
description: An analyst agent that buys its own market intelligence over x402 and trades a Binance sub-account only inside a written rulebook.
---

# Olai

Olai is an analyst agent for a Binance sub-account.

A trader hands it two things: a funded Binance Agentic sub-account and a rulebook written in
plain English. The rulebook says the biggest order size, the most the agent may lose in a day,
which markets it may touch, and how much it may spend on data. Then the trader asks a question,
for example "should I trim my BNB position before the weekend?"

Olai searches Binance's B402 Bazaar for the paid data that answers the question, pays each
merchant a cent or two over x402 from its Binance Agentic Wallet, reads the live market through
Binance's exchange REST API on the sub-account, and proposes one action. The owner approves or
rejects, from the desk at `/app` or by calling the owner API directly. Only then does an order
reach the exchange.

Olai's exchange leg was meant to run through Binance's hosted MCP server, the door Agent OS
documents for it. Binance's own consent page turned Olai's OAuth client away: "The AI Agent you
are using is not currently supported. Please connect using a supported Agent to continue.
(3346001-e450fe8d)". The allowlist admits only Binance's own agents today, so Olai trades over
the exchange REST API instead, with a trade-only key on an isolated sub-account. See
[Why Binance Agent OS](./concepts/why-binance-agent-os.md) and
[The MCP client](./developers/mcp-client.md) for the full story.

Every step lands in a hash-chained ledger: the question, the data bought, what it cost, the
settlement transaction hash, the rulebook's verdict, the approval, and the fill.

## The three rules the product is built on

1. **The model never decides.** The rulebook is a pure function in code
   (`packages/agent/src/policy/engine.ts`). It runs before every payment and twice before every
   order. Nothing the model writes can talk it out of a refusal.
2. **The model never places an order.** Only `SessionRunner.approve` in
   `packages/agent/src/session/session.ts` calls `exchange.placeOrder`, and only after the owner
   sends `POST /api/sessions/:id/approve` with their own bearer token.
3. **Nothing is unrecorded.** The ledger is append only at the database level and hash chained,
   so an edited line breaks every hash after it and `verifyChain()` names the first broken line.

## Where to go next

| You want to | Read |
|---|---|
| Run it on your own machine | [Quick start](./getting-started/quick-start.md) |
| See one question end to end | [First question](./getting-started/first-question.md) |
| Understand the shape of it | [How it works](./concepts/how-it-works.md) |
| Understand what stops it | [Trust model](./concepts/trust-model.md) |
| Write the rules it runs under | [Write a rulebook](./guides/write-a-rulebook.md) |
| Build against it | [Architecture](./developers/architecture.md) and [Owner API](./developers/owner-api.md) |
| Attack it | [Security overview](./security/overview.md) |

## What's still missing

The owner's desk ships at `/app` (`packages/web/src/app/app/page.tsx`, components under
`packages/web/src/components/conversation`), reading and writing through the owner API this
documentation describes. It is one conversation: a welcome card with three steps, a box to ask in,
Olai's steps arriving as plain sentences, a proposal card with **Approve** and **Reject**, a
**Details** drawer holding the rulebook, the wallet and account, and the ledger, and a **Stop
Olai** button in the header. What is still missing, and the other open gaps, are listed in the
[FAQ](./faq.md#whats-still-missing).
