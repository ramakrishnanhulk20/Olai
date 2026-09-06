---
title: Dry run versus live
sidebar_position: 6
description: What each mode stops, the two places dry run is enforced, and the checklist before the first live run.
---

# Dry run versus live

`OLAI_DRY_RUN` defaults to `true`. It is the single setting that separates an agent that plans
from an agent that spends.

## What each mode does

| | Dry run (`true`) | Live (`false`) |
|---|---|---|
| Bazaar search | runs | runs |
| x402 price preview with the wallet | runs | runs |
| Wallet signature | never asked for | asked for, once per payment |
| Merchant paid call | not made | made, settlement hash recorded |
| Free market reads | run | run |
| Proposal and rulebook checks | run | run |
| Owner approval | works | works |
| Order sent to Binance | never | yes, one per session |
| Ledger | written in full | written in full |

## The two places it is enforced

Dry run is not one flag checked in one place. It is checked separately for the two different
kinds of spending, so a bug in one path cannot open the other.

**Money on data**: `buy()` in `packages/agent/src/x402/buyer.ts` returns
`{ status: 'dry-run', costUsd, paymentId, option }` after the wallet has priced the call and
before `x402Sign` is reached. You get the real price without a real payment.

**Money on trades**: `SessionRunner.approve` in `packages/agent/src/session/session.ts` writes an
`order.sent` line marked `dryRun: true` and returns without calling `exchange.placeOrder` at all.

The model is also told, in its system text, that `buy_data` will price but not pay, so its
reasoning matches what is actually happening.

## Going live

Setting `OLAI_DRY_RUN=false` on its own is not enough, and that is on purpose.

- **Olai refuses to boot live without a Binance connection.** The fake exchange is only allowed
  in a dry run, so a live run with no sign-in token stops at boot with one readable line instead
  of trading against a stand-in.
- **The prove script needs a second key.** `npm run prove` only spends money when
  `OLAI_DRY_RUN=false` and `OLAI_PROVE_SPEND=yes`. Two settings, so neither one alone can lead
  to a payment.
- **The wallet has its own ceiling.** `x402DailyLimit` is set in the Binance app and Olai cannot
  raise it. The lower of that limit and the rulebook's `maxDataSpendUsdPerDay` is what actually
  binds.

## Before the first live run

1. Run the same question in dry run first and read the proposal. Every live run should be a
   repeat of a dry run you have already read.
2. Check the rulebook: `GET /api/rulebook`. The starter values are small on purpose.
3. Check the wallet: `baw wallet status --json` says `CONNECTED`, and `wallet settings` shows an
   `x402DailyLimit` you are willing to lose.
4. Check the sub-account has the funds the order needs, and no more than you want at risk.
5. Confirm `GET /health` reports `dryRun: false` and `killed: false`.
6. Keep `POST /api/kill` in reach.

Remember there is no testnet for the MCP server or the Agentic Wallet. A live run spends real
cents and places real orders. The sub-account balance and the wallet's daily limit are the only
ceilings underneath your rulebook.
