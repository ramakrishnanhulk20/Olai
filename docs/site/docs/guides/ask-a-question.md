---
title: Ask a question
sidebar_position: 2
description: What a good question looks like, what the agent may do with it, and what comes back.
---

# Ask a question

## From the desk

Type the question into the **Ask Olai** box and send it. Sending is disabled while a question is
already running, while Olai is stopped, or while the service cannot be reached. The button reads
"Olai is working…" during a session, next to a note that every answer is paid for from the wallet.
A session can take a minute or more, so the wait carries an honest label instead of a bare
spinner: "Olai is reading the market and shopping for data, this can take a minute," with a
running seconds count beside it. The same steps land in the **Thinking** panel below as they
happen, and the result lands in the proposal card once `propose` is called. These are
`packages/web/src/components/desk/ask-box.tsx` and
`packages/web/src/components/desk/thinking-stream.tsx`.

## From the command line

```bash
curl -X POST http://localhost:4000/api/ask \
  -H "Authorization: Bearer $OLAI_OWNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"question":"Should I trim my BNB position before the weekend?"}'
```

The question is 1 to 2000 characters after trimming (`askSchema` in
`packages/agent/src/api/app.ts`). Anything else comes back as a 400 naming the problem.

## What Olai does with it

The brain gets seven tools and nothing else (`packages/agent/src/brain/analyst.ts`):

| Tool | Costs | What it does |
|---|---|---|
| `search_bazaar` | free | Searches the B402 Bazaar. Returns at most eight results the Binance wallet can actually pay for, cheapest first. Buys nothing. |
| `buy_data` | real money | Pays one merchant over x402 and returns what it sends back. The rulebook is checked in code first. |
| `read_ticker` | free | Last price and the 24 hour move for one symbol. |
| `read_order_book` | free | Top of the book, up to 20 levels, to see how thin the market is. |
| `read_klines` | free | Recent candles for trend and volatility. |
| `read_account` | free | Balances and open positions on the sub-account. |
| `propose` | free | Ends the session with one proposal. Called exactly once, last. |

There is no order tool in that list. The model cannot place an order, and it cannot raise its own
spending cap: whatever `maxUsdPrice` it asks `search_bazaar` for is clamped to the rulebook's
`maxDataSpendUsdPerCall` before the search runs.

## What comes back

A session record:

```json
{
  "id": "ol-3f0c...",
  "question": "Should I trim my BNB position before the weekend?",
  "createdAt": "2026-09-06T09:12:44.106Z",
  "status": "pending",
  "proposal": {
    "summary": "...",
    "reasoning": "...",
    "action": {
      "type": "order",
      "symbol": "BNBUSDT",
      "side": "SELL",
      "quoteUsd": 15,
      "orderType": "MARKET"
    },
    "confidence": 0.62,
    "dataUsed": [{ "url": "...", "costUsd": 0.01, "txHash": "0x..." }],
    "risks": ["..."]
  },
  "verdict": {
    "allowed": true,
    "requiresApproval": true,
    "effectiveMaxOrderUsd": 20,
    "reasons": ["This order is above $0.00, so the owner has to approve it."],
    "ruleIds": ["order.needs_approval"]
  }
}
```

`status` is one of:

| Status | Meaning |
|---|---|
| `pending` | There is an order waiting for you. |
| `refused` | The rulebook refused the proposal. Nothing to approve. Read `verdict.reasons`. |
| `approved` | Olai proposed holding. Nothing to do, nothing to send. |
| `rejected` | You said no. |
| `executed` | The order was sent and came back filled, or, in a dry run, was recorded and not sent. |
| `failed` | The exchange refused it or the call threw. |

`dataUsed` is written by the model itself. It is not cross-checked against the ledger, so treat
it as the model's account of what it bought and read the ledger for what actually happened. See
[Read the ledger](./read-the-ledger.md).

## Watching it think

`GET /api/events` is a server-sent event stream carrying the same commentary the dry-run script
prints: thinking fragments, answer text, every tool call and every tool result. It opens with a
`ready` event and sends a heartbeat comment every 15 seconds so a proxy does not close an idle
stream. At most 16 streams may be open at once.

The desk reads this stream with `fetch` and a stream reader rather than `EventSource`, because
`EventSource` cannot carry the `Authorization` header the owner's token needs
(`packages/web/src/lib/sse.ts`).

The stream is commentary, not the record. Nothing is proven by it. The ledger is the record.

## Questions that work

Ask about a position, a market on the allowed list, and a decision you would actually make:

- "Should I trim my BNB position before the weekend?"
- "Is there anything in the flows that argues against adding to ETH today?"
- "What does the order book look like for BTCUSDT right now, and does it change the case for
  buying 20 dollars' worth?"

Asking about a market that is not in `allowedSymbols` is not an error. Olai will research it and
propose something, and the rulebook will refuse the order with `order.symbol_not_allowed` before
you are asked to approve anything.
