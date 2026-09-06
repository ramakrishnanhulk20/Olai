---
title: Trust model
sidebar_position: 3
description: The rulebook in code, the hash-chained ledger, the kill switch, and Binance's own controls underneath all three.
---

# Trust model

Olai's answer to "why would you let a model near your money" is four layers, three of which are
in this repository and one of which is Binance's.

## 1. The rulebook is code, not a prompt

The rulebook is a plain object the owner writes. `evaluate(rulebook, action, state)` in
`packages/agent/src/policy/engine.ts` checks one proposed action against it and returns a
verdict. Three things make it load bearing:

**It is a pure function.** No clock read, no database read, no network. The same rulebook, action
and state give the same verdict every time, which is what lets anyone replay a past decision from
the ledger and get the same answer.

**It runs before anything moves, in three places.** Inside the `buy_data` tool before
`deps.data.buy` is ever called, in `SessionRunner.ask` the moment a proposal comes back, and
again in `SessionRunner.approve` against a fresh account snapshot. The second order check is not
redundant: the day's loss, the open positions and the kill switch can all change while a proposal
sits waiting for the owner.

**It never throws.** Nonsense input (NaN, Infinity, negative money, an unreadable timestamp)
comes back as a refusal. An agent that crashes on bad input is an agent whose rules can be
skipped by sending bad input.

The model is told about the rulebook in its system text, and it will sometimes try to act outside
it anyway. That is assumed. The defence is that its output is checked in code and never trusted
as a decision. Every refusal carries a stable rule id, for example `order.max_size`,
`payment.daily_budget`, `risk.drawdown_halt`, `agent.killed`. Those ids are part of the product
and do not change once shipped.

## 2. The ledger cannot be quietly edited

One SQLite file, one table, append only, hash chained
(`packages/agent/src/ledger/ledger.ts` and `hash.ts`).

- Every line's hash is sha256 over the previous line's hash plus the canonical JSON of this line.
  Edit any old line and every later hash stops matching.
- `verifyChain()` walks the whole table, recomputes every hash, and returns the sequence number
  of the first line that does not hold up, with a plain-English reason.
- Two SQL triggers, `ledger_no_update` and `ledger_no_delete`, make UPDATE and DELETE raise an
  abort at the database level. Tampering has to go around SQLite entirely and edit the file
  bytes, which is exactly what `verifyChain` is built to catch.
- The timestamp is set by the ledger, never by the caller, so nobody can backdate a line.
- Money is stored as whole cents, because a day of one-cent payments added as floating point
  drifts, and a spend report that is a cent out is a report nobody trusts.

`GET /api/ledger/verify` exposes that check over the API, so the owner can ask at any moment.

## 3. The kill switch

`SessionRunner.kill()` sets a private flag. Two details make it hold:

- `SessionRunner.state()` always ORs the local killed flag over whatever the account snapshot
  says, so a stale or wrong account read can never un-kill the agent.
- `evaluate()` refuses everything, orders and payments alike, the instant `state.killed` is true,
  under the rule id `agent.killed`.

What it does not do: it does not cancel an order already sent to Binance. Kill stops the next
thing, not the thing in flight. See [Kill switch](../guides/kill-switch.md).

## 4. Binance's own controls, underneath all of it

These are outside Olai's code and Olai relies on them.

- **No withdrawal permission exists on the trading key.** The Binance API key Olai trades with
  is scoped to Enable Spot Trading only, no withdrawals. Money cannot leave Binance through the
  door Olai uses. The secret itself is never logged or sent as anything but an HMAC signature
  (`packages/agent/src/exchange/sign.ts`).
- **The Agentic sub-account is walled off** from the owner's main account. The agent cannot pull
  funds into it.
- **The Agentic Wallet has daily limits** set only in the Binance app, including a separate
  `x402DailyLimit` for exactly the kind of spending Olai does. `baw wallet settings` can read
  them and nothing can write them.
- **Wallet sends only go to addresses already in the owner's address book.**
- **The wallet sign-in is time-boxed** at 48 hours, so an unattended machine stops being able to
  pay after two days.
- **Binance's own skills document a confirm-before-execute pattern.** Olai is not running inside
  Claude Code, so it gets no external confirm prompt. The owner-approval gate in
  `SessionRunner.approve` is the equivalent Olai implements itself.

## The one door in

Every route under `/api/*` needs the owner's bearer token, checked in
`packages/agent/src/api/auth.ts`. Three details:

- The token lives in its own namespace: it starts with `ol.` and is at least 24 characters, while
  session ids look like `ol-<uuid>`. Knowing an id can never make you the owner.
- Both sides are sha256-hashed before `timingSafeEqual`, so tokens of different lengths still
  compare in constant time and the real token's length is not leaked by timing.
- The token is checked at boot too, so Olai refuses to start with a weak lock on the door.

On top of that: 60 requests a minute per address, counted on the socket address unless the
deployment explicitly says it sits behind a proxy; a 64 KB body limit; one named browser origin
in CORS; and every external input parsed with a schema before use.

## What we did not fix

Being honest about the gaps is part of the model. The full list is in the
[threat model](../security/threat-model.md). The four that matter most to a reader here:

1. **Daily loss counts unrealised moves.** It is computed from equity snapshots, so a held
   position that merely drops in price today trips `maxDailyLossUsd` the same as a losing trade.
2. **Some guards are in memory only.** The pending session list and the one-signature-per-payment
   guard do not survive a process restart. The ledger is still the durable record, and a durable
   signature guard backed by the ledger exists in `ports/data.ts`, but the in-process sets are
   gone after a restart.
3. **Merchant text is trusted as data after schema validation.** Nothing strips instruction-like
   text from a merchant's description before the model reads it. The defence is entirely
   downstream, in the rulebook refusing whatever the model proposes as a result.
4. **The model writes its own `dataUsed` list.** Nothing cross-checks it against what the ledger
   recorded from `buy_data` in the same session. Read the ledger, not the proposal, for what was
   actually bought.
5. **A compromised trading key could still trade.** The Binance API key has no withdrawal
   permission, but whoever holds it could buy or sell on the sub-account up to its balance and
   pay trading fees on every order. It could never move money off Binance.
