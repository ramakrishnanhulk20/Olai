---
title: Your first question
sidebar_position: 2
description: Run the dry run, read what it prints, and see one question go from asking to a verified ledger.
---

# Your first question

The first thing to run is the dry run. It boots the whole service exactly as `npm run dev`
would, forces dry run on top of whatever `.env` says, asks one question, and prints everything
that happened. Nothing in it can move money.

```bash
npm run dry-run -w @olai/agent -- "Should I trim my BNB position before the weekend?"
```

With no question after the `--`, it asks that same default question
(`packages/agent/scripts/dry-run.ts`, `DEFAULT_QUESTION`).

This page runs the whole path from the command line on purpose, since it is the fastest way to
see every step at once with nothing hidden. To watch the same path by clicking instead, open the
desk at `/app`. The welcome card, **Your analyst is ready.**, walks the same three steps: check
the rulebook, ask a question, approve or reject what Olai proposes. Type into the box at the
bottom or tap one of the three example chips, watch Olai's steps arrive one plain sentence at a
time, and answer the proposal card at the end.

## What it prints, in order

**1. What it booted with.** One line naming the exchange it connected to, the ledger file, and
the public address:

```
Olai booted: dry run, exchange <name>, ledger ./data/olai.db, address http://127.0.0.1:4000
```

With `OLAI_EXCHANGE=auto`, the name comes from what you have: the Binance REST key first, then a
stored MCP token, then the deterministic stand-in, and the stand-in in a dry run only.
`buildService` refuses to boot a live run without a real connection.

**2. The question**, back as Olai read it.

**3. The thinking, as it happens.** The script subscribes to `GET /api/events`, the same
server-sent event stream the desk itself reads (`packages/web/src/lib/sse.ts`), so this output
proves the feed works rather than reaching inside the service for a shortcut. Thinking text and
answer text stream in fragments. Each tool call prints twice, once when it is asked and once when
it answers:

```
  asking search_bazaar
  search_bazaar: Bazaar search "BNB wallet flows" under $0.05: 3 payable results
  asking buy_data
  buy_data: ...
  asking read_ticker
  read_ticker: BNBUSDT at ..., ...% over 24 hours
```

**4. The proposal.** One summary line, then the model's confidence between 0 and 1, the action
as JSON, and one line per risk it named:

```
Proposal: <one sentence>
  confidence: 0.62
  action: {"type":"order","symbol":"BNBUSDT","side":"SELL","quoteUsd":15,"orderType":"MARKET"}
  risk: <what could go wrong>
```

The only two actions that can come back are `order` and `hold` (`proposalSchema` in
`packages/agent/src/brain/proposal.ts`).

**5. The rulebook's verdict.** Allowed or refused, with the rule ids that fired and their
plain-English reasons:

```
Rulebook: allowed (order.needs_approval) This order is above $0.00, so the owner has to approve it.
```

**6. The approval.** The script plays the owner and approves, so you see the whole path. The
rulebook is checked a second time here against a fresh account snapshot before anything is sent.
In a dry run the order stops there: a ledger line marked `dryRun: true` is written and
`exchange.placeOrder` is never called.

**7. Every ledger line the session wrote**, with its sequence number, kind, actor, cost where
there is one, and its summary:

```
Ledger lines for this session:
  12 question by owner: ...
  13 discovery by agent: ...
  14 payment.preview by agent ($0.0100): ...
  15 proposal by agent: ...
  16 approval by owner: ...
  17 order.sent by agent: ...
```

**8. Whether the chain still holds.**

```
Ledger chain holds across all 17 lines.
```

The script exits 0 when the chain holds and 1 when it does not, so it is usable in a check.

## Then prove it against the live network

```bash
npm run prove -w @olai/agent
```

Seven steps against the real Binance Agentic Wallet, the live B402 Bazaar, a live merchant's 402
response, the exchange Olai booted with, and the ledger. Each prints `PASS`, `FAIL` or `SKIP`
with a reason. Only step 4 can spend money, and only when `.env` has both `OLAI_DRY_RUN=false`
and `OLAI_PROVE_SPEND=yes`. Everything else is read only.

```
PASS 1. wallet CONNECTED, x402 daily limit $..., quota left $...
PASS 2. Bazaar has N wallet payable listings for "wallet balance" under $0.05, cheapest $... at ...
PASS 3. a real 402 previewed to payment ... with N options, top option is READY_TO_SIGN for $... in ... on chain ...
SKIP 4. OLAI_DRY_RUN is true, so Olai will not sign anything
PASS 5. ... priced BNBUSDT at ...
PASS 6. the ledger hash chain holds across all N lines
PASS 7. this run spent $0.0000 across 0 settled payments (0 signatures claimed)
```

## If something goes wrong

| What you see | What it means |
|---|---|
| A list of settings with one problem each, then nothing starts | `loadConfig` refused the `.env`. Fix the named keys and run again. |
| `Olai will not run live without a Binance connection` | `OLAI_DRY_RUN=false` with no sign-in token. Either finish the OAuth step or go back to dry run. |
| `FAIL 1` in prove, wallet not connected or `baw` not installed | Install the CLI with `npm install -g @binance/agentic-wallet`, then run `baw auth signin` again. The wallet session lasts 48 hours. |
| Every x402 option comes back `ACTION_REQUIRED` with `INSUFFICIENT_BALANCE` | The Agentic Wallet is empty. Fund it on BNB Smart Chain. |
| A refusal you did not expect | Read the rule id in the verdict against [Write a rulebook](../guides/write-a-rulebook.md). |
