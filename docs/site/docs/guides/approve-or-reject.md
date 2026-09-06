---
title: Approve or reject
sidebar_position: 3
description: The one step that releases an order, what is checked again before it goes, and what lands in the ledger.
---

# Approve or reject

A proposal sits at `pending` until you answer it. This is the only step that can release an
order, and it always carries the owner's own token, never something the model can produce.

## From the desk

The proposal card shows the rulebook's own verdict above the two buttons: "The rulebook allows
this" or "The rulebook refuses this," each reason lined up with the rule id that produced it, and
the biggest order size the rules allow right now. Click **Approve** to send it (the button reads
"Sending…" while the call is in flight), or click **Reject** to reveal a one-line reason field and
a **Record the rejection** button. Both buttons disable the instant either is clicked, so a second
click cannot send a second order. This is `packages/web/src/components/desk/proposal-card.tsx`.

## From the command line

The same two actions as plain HTTP calls, useful for scripting or for checking the desk against
the API directly:

```bash
curl -X POST http://localhost:4000/api/sessions/ol-3f0c.../approve \
  -H "Authorization: Bearer $OLAI_OWNER_TOKEN"
```

```bash
curl -X POST http://localhost:4000/api/sessions/ol-3f0c.../reject \
  -H "Authorization: Bearer $OLAI_OWNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"reason":"I want to see the weekly close first."}'
```

The reason is optional, up to 500 characters. Left out, it records "The owner gave no reason."

## What approval actually does

Read from `SessionRunner.approve` in `packages/agent/src/session/session.ts`, in order:

1. **Already done?** If the session is `executed`, or the runner has already reached the exchange
   for it, the existing record comes straight back. Approving twice sends one order.
2. **Still pending?** Anything else that is not `pending` is a 409 saying what state it is in.
3. **The rulebook runs again**, against an account snapshot taken now, not the one from when the
   proposal was made. The day's loss, the open positions and the kill switch can all have moved
   while you were thinking. A refusal here writes a `rule.refused` line and the session becomes
   `refused`. This is the check that stops an approval clicked twenty minutes late from trading
   against a state that no longer exists.
4. **The approval is recorded** as an `approval` line by the owner.
5. **The session is marked as ordered before the exchange is called.** If the send throws, we do
   not know whether Binance got it, and a second attempt could buy twice. One order per session,
   even a failed one, is the safe reading.
6. **The order goes out**, with the session id as the client order id, so a line in Binance's own
   records can be matched to a line in Olai's.
7. **The result is recorded**: `order.filled` on a fill, `order.failed` when Binance comes back
   `REJECTED` or `CANCELED`, or when the call threw.

In a dry run, steps 6 and 7 do not happen. The session goes to `executed` and an `order.sent`
line marked `dryRun: true` says plainly that nothing was sent to Binance.

## What rejection does

The session becomes `rejected` and a `rejection` line goes in the ledger with your reason.
Nothing is sent. A rejected session cannot be approved afterwards: a second call gets a 409.

## The ledger lines you should see

For an approved order that filled, in this order:

```
approval    by owner   Owner approved SELL BNBUSDT
order.sent  by agent   Sent SELL BNBUSDT for 15 USD
order.filled by binance FILLED: 0.0231 BNBUSDT for 15.00 USD
```

For an approval the rulebook stopped:

```
rule.refused by rulebook The rulebook refused this order at approval time: <reasons>
```

## Errors you can get

| Status | When |
|---|---|
| 401 | The bearer token is missing or wrong. |
| 404 | No session with that id. Session records live in memory, so a restart loses the pending list. The ledger keeps what happened. |
| 409 | The session is not pending any more: already executed, rejected, refused, or it was a hold with nothing to approve. |
| 429 | More than 60 requests in a minute from this address. |
| 502 | The exchange or the account read failed. Nothing was sent. |
