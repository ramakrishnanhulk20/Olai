---
title: Kill switch
sidebar_position: 5
description: How to stop the agent, what stopping covers, and what it does not.
---

# Kill switch

## From the desk

**Stop Olai** is the last button in the header, to the right of **Details**. Clicking it asks
first: a dialog headed "Stop Olai?" with the line "Every order and payment is refused until you
resume," and two buttons, **Stop Olai** and **Keep running**. Once stopped, the same button reads
**Resume Olai** and one click undoes it with no dialog, because undoing a stop is the safe
direction and does not need a second confirmation.

The status chip left of the buttons reads LIVE, DRY RUN, STOPPED, NO SERVICE, CHECKING or REPLAY,
from the same `/health` poll described below. While the flag is on, the box at the bottom refuses
new questions with "Olai is stopped. Resume it at the top of the screen before asking anything."
Both the stop and the resume land in the conversation as sentences of their own, "You stopped
Olai" and "You resumed Olai". A visitor watching the replay sees the button disabled, with the
hover note "Stopping Olai is the owner's to do." This is
`packages/web/src/components/conversation/stop-button.tsx`,
`packages/web/src/components/conversation/header.tsx` and
`packages/web/src/components/desk/status-chip.tsx`.

## From the command line

```bash
curl -X POST http://localhost:4000/api/kill \
  -H "Authorization: Bearer $OLAI_OWNER_TOKEN"
```

```json
{ "killed": true }
```

Turn it off again:

```bash
curl -X POST http://localhost:4000/api/resume \
  -H "Authorization: Bearer $OLAI_OWNER_TOKEN"
```

`GET /health` reports the current state without a token, as `{ ok, dryRun, killed, version }`,
so a monitor can watch it.

## What being killed covers

The flag lives on the session runner (`packages/agent/src/session/session.ts`). Two details make
it hold:

- `SessionRunner.state()` ORs the local killed flag over whatever the account snapshot says. A
  stale or wrong reading of the account cannot un-kill the agent.
- `evaluate()` in `packages/agent/src/policy/engine.ts` refuses everything the instant
  `state.killed` is true, under rule id `agent.killed`, before it looks at any other rule.

So while it is on:

- No order can be approved. An approval hits the second rulebook check and is refused.
- No data payment can be made. `buy_data` checks the rulebook before the wallet is ever asked to
  sign, and the check refuses.
- Questions still run, and every refusal is recorded, so you can see what the agent wanted to do
  while it was stopped.

Both the kill and the resume are ledger lines (`kill`, `resume`), so the record shows exactly
when the agent was stopped and by whom.

## What it does not cover

**An order already sent.** Kill stops the next thing, not the thing in flight. Nothing in
`SessionRunner.kill()` calls a cancel path on Binance. If an order is live on the exchange, cancel
it in the Binance interface.

**A payment already signed.** Once the wallet has signed and the merchant has the header, the
payment is out of Olai's hands.

**Nothing outside this process.** Kill is Olai's own flag. It does not touch the wallet's limits
or the sub-account. If you want a hard stop at the Binance level, use the Binance app: lower the
wallet's daily limits, or move funds out of the sub-account.

## The full stop, in order

If something is genuinely wrong, in this order:

1. `POST /api/kill`. Olai stops proposing anything that can be approved and stops paying.
2. Cancel any open order in the Binance interface.
3. `baw auth signout --json`, which ends the wallet session, so no x402 payment can be signed
   even if the process is restarted with the flag off.
4. Stop the process. The ledger is a file on disk and survives.
5. Read what happened: `GET /api/ledger` before you stop the process, or open the SQLite file
   after.
