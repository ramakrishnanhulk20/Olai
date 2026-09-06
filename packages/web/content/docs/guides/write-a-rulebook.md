---
title: Write a rulebook
sidebar_position: 1
description: Every field of the rulebook, what it means, what it refuses, and the value a fresh install starts with.
---

# Write a rulebook

The rulebook is the contract between the owner and the agent. It is written once, stored in the
ledger every time it changes, and checked in code before anything moves. The shape is defined by
`rulebookSchema` in `packages/agent/src/policy/rulebook.ts`, and the starter values below come
from `defaultRulebook` in `packages/agent/src/rulebook/store.ts`.

## The starter rulebook

This is what a fresh install runs under: small sizes, three liquid markets, and approval required
on every order, so the first thing you ever see is Olai asking permission rather than Olai
trading.

```json
{
  "version": 1,
  "name": "Olai starter rulebook",
  "maxOrderUsd": 20,
  "maxDailyLossUsd": 10,
  "maxPositionUsdPerSymbol": 50,
  "allowedSymbols": ["BNBUSDT", "BTCUSDT", "ETHUSDT"],
  "allowShort": false,
  "allowLeverage": false,
  "maxDataSpendUsdPerDay": 1,
  "maxDataSpendUsdPerCall": 0.05,
  "cooldownSecondsBetweenOrders": 60,
  "requireApprovalAboveUsd": 0,
  "oneSidePerMarket": true,
  "drawdownTiers": [
    { "lossUsd": 5, "action": "halve" },
    { "lossUsd": 10, "action": "halt" }
  ]
}
```

## Every field

### version

Always the number `1`. It is a literal in the schema, not a free number. It exists so a future
rulebook shape can be told apart from this one.

### name

Text, 1 to 80 characters, trimmed. It appears in the ledger line every save writes
(`Rulebook "<name>" was set by the owner`), so give it something you will recognise months later.

Default: `Olai starter rulebook`.

### maxOrderUsd

The biggest single order, in US dollars. An order above it is refused with rule id
`order.max_size` before the owner ever sees it.

This is a ceiling, not the number actually used. Drawdown tiers can halve it during the day, and
the verdict reports the number in force as `effectiveMaxOrderUsd`.

Default: `20`.

### maxDailyLossUsd

The most the account may be down today before trading stops for the day. Rule id
`risk.daily_loss_reached`, and it sets the effective max order to zero.

Read the honest limit here: today's loss is measured from an equity snapshot taken at the first
account read of the UTC day (`packages/agent/src/account/state.ts`), so a held position that
merely drops in price counts the same as a losing trade.

Default: `10`.

### maxPositionUsdPerSymbol

The most that may be open in one market after the order lands. Olai nets long and short per
symbol, then checks the resulting size against this. Rule id `order.max_position`.

Default: `50`.

### allowedSymbols

The markets Olai may trade, as Binance symbols. Each has to match `[A-Z0-9]{4,20}` in upper
case, for example `BNBUSDT`. At most 50 of them, because a rulebook with more than 50 markets is
not a rulebook. Anything not on the list is refused with `order.symbol_not_allowed`, and the
refusal names the list.

Default: `["BNBUSDT", "BTCUSDT", "ETHUSDT"]`.

### allowShort

`true` lets Olai sell a market it has nothing long in. `false` refuses that with
`order.short_not_allowed`. Selling into an existing long is always allowed.

Default: `false`.

### allowLeverage

Always `false`. It is a literal in the schema, so it is not a setting you can turn on. Olai is a
spot agent: leverage is a capability the product does not have. Any proposal with leverage above
1 is refused with `order.leverage_not_allowed`.

Default: `false`.

### maxDataSpendUsdPerDay

The daily budget for buying data over x402. Olai adds up what it has settled today and refuses
the payment that would cross the line, with `payment.daily_budget`.

This is Olai's own ceiling. The Agentic Wallet has its own separate `x402DailyLimit` set in the
Binance app, and the lower of the two wins in practice.

Default: `1`.

### maxDataSpendUsdPerCall

The most one data call may cost. Two things use it: the payment check refuses anything above it
with `payment.max_per_call`, and the Bazaar search clamps whatever price cap the model asked for
down to this number, so the model cannot raise its own budget by asking for a bigger one.

It has to be less than or equal to `maxDataSpendUsdPerDay`. The schema refuses to save a rulebook
where a single call could cost more than the whole day.

Default: `0.05`.

### cooldownSecondsBetweenOrders

Whole seconds between orders, 0 to 86400. Inside the window an order is refused with
`order.cooldown` and the reason says how many seconds are left. A last-order time stamped in the
future means a clock problem somewhere, and the safe reading of a clock problem is to wait.

Default: `60`.

### tradingHoursUtc

Optional. An object like `{ "start": 8, "end": 20 }`, both whole hours 0 to 23, read in UTC.
Outside the window an order is refused with `order.trading_hours`. A window that wraps midnight
works: `{ "start": 22, "end": 4 }` means 22:00 to 04:00. The two hours cannot be equal, because
that window has no meaning.

Leave it out to trade around the clock. It is absent from the starter rulebook.

### requireApprovalAboveUsd

Orders above this size need the owner to approve. The starter value is `0`, so every order does.
It is the one rule that does not refuse: it sets `requiresApproval` on the verdict, with rule id
`order.needs_approval`.

Approval is a real HTTP call with the owner's token, never something the model can produce.

Default: `0`.

### oneSidePerMarket

Always `true`, a literal in the schema. Olai will not hold both directions in one market and
will not flip a position through zero in a single order. Two refusals come from it, both with
`order.one_side_per_market`: buying while a short is open, and a sell bigger than the long that
would leave the market short. The second refusal tells you the largest sell that would be
allowed.

Default: `true`.

### drawdownTiers

A list of at most ten `{ lossUsd, action }` pairs, where action is `halve` or `halt`. As the
day's loss passes each tier, that tier's action applies:

- `halve` cuts the biggest single order in half, rule id `risk.drawdown_halve`.
- `halt` stops trading for the day, rule id `risk.drawdown_halt`.

Tiers apply in the order you wrote them, so two `halve` tiers in a row cut size to a quarter.
That is deliberate: it is what asking for size to keep shrinking as the day gets worse looks
like.

Default: `[{ "lossUsd": 5, "action": "halve" }, { "lossUsd": 10, "action": "halt" }]`.

## Rules on the numbers themselves

Every dollar field is checked as money, not trusted as a number: it has to be a real number, not
negative, at most two decimal places, and no larger than 1,000,000,000. Every rule inside the
engine is then decided in whole cents, because comparing dollars as floating point gets the edge
case wrong: 0.1 plus 0.2 is not 0.3 in binary, and a 0.30 daily budget would look breached by a
payment that exactly fills it.

A rulebook that fails any of this is refused at save time with the exact field and reason. As a
second line of defence, `evaluate` re-checks the shape at runtime and refuses everything if the
rulebook does not look real, so a file edited by hand into nonsense stops the agent rather than
loosening it.

## Saving one

On the desk, the Rulebook panel is a form matching every field above one for one: money fields
carry a `$` prefix, "Markets it may trade" adds a chip per symbol, "May sell what it does not
hold" and "Only trade between two hours, UTC" are switches, and "Cut back after losing" lists the
drawdown tiers with an "Add a tier" button. A box marked "Not yours to change" explains that
leverage is off and one side per market is on, because those are not settings, they are things
Olai cannot do. **Save the rulebook** submits the form; a save the schema refuses shows the exact
reason under the field it belongs to, because the agent returns `issues` per field and the panel
indexes them by path (`packages/web/src/components/desk/rulebook-panel.tsx`), and a save that
succeeds says "Saved, and recorded in the ledger."

The same write as a plain HTTP call, useful for scripting a whole rulebook at once:

```bash
curl -X PUT http://localhost:4000/api/rulebook \
  -H "Authorization: Bearer $OLAI_OWNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d @rulebook.json
```

Two copies are kept on purpose. The JSON file at `OLAI_RULEBOOK_PATH` is what the agent reads
when it starts. The ledger holds every version that was ever in force, as a `rulebook.set` line.
The file can be edited by anyone with the machine; the ledger line cannot be changed without
breaking the hash chain, so a rulebook that was quietly loosened is always provable after the
fact.

The write itself is atomic: the file goes to a temporary name in the same directory and is
renamed over the old one, so a crash halfway through leaves the previous rulebook intact rather
than half a file the agent cannot read.
