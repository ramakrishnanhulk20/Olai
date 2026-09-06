---
title: Why Binance Agent OS
sidebar_position: 2
description: What only Agent OS gives Olai, and what the product would lose without each door.
---

# Why Binance Agent OS

Binance built four doors that let an agent act on a person's money without holding that person's
keys. Olai walks through all four. Take any one of them away and a specific part of the product
stops existing.

## The four doors

**The Exchange REST and WebSocket APIs.** Binance's own docs list these as an Agent OS tool in
their own right: "Binance Exchange APIs: REST and WebSocket for market and trading data." This is
the door into the exchange that Olai actually walks through. The agent gets a walled sub-account
the owner funds by hand, signs every request with a trade-only HMAC key, and can read markets,
read balances and send spot orders inside that sub-account. It can never withdraw: the key carries
no withdrawal permission. Olai uses it for four free reads and for the one order an approval
releases (`packages/agent/src/exchange/rest.ts`).

The same tool also ships as a hosted MCP server, `https://agent.binance.com/mcp/agentic`, and
Olai built a full client for it (`packages/agent/src/mcp`). That door is closed today: Binance's
consent page answered Olai's own OAuth client with "The AI Agent you are using is not currently
supported. Please connect using a supported Agent to continue. (3346001-e450fe8d)", because the
allowlist admits only Binance's own agents. Olai trades over the REST API instead until Binance
opens it to third-party agents.

**The Agentic Wallet, driven by the `baw` CLI.** The door on-chain. A Binance-managed wallet
under the owner's account with daily limits set in the Binance app, including a separate
`x402DailyLimit` that governs exactly the kind of spending Olai does. Olai calls
`x402-payment preview` and `x402-payment sign` and holds no key material at any point.

**x402, which Binance implements as B402.** The way one machine pays another per HTTP request,
on-chain, with gas sponsored on BNB Smart Chain. This is what makes "a cent a call" a real
payment method rather than a metaphor. Binance's wallet supports x402 version 2 only, on BSC,
Base and Solana.

**The B402 Bazaar.** The public catalogue where an agent finds things to buy. No key, no
account, no sign-up. It listed 979 paid resources when this project started, priced between one
cent and two dollars, including Nansen, CoinMarketCap and Cournot.

## The delete test

Remove Binance's tech and the product has to collapse. It does.

| Take away | What is left |
|---|---|
| The exchange API | No sub-account, no walled trading surface, no way to read the live book or send an order under someone else's ceiling. Olai becomes a chat window. |
| The Agentic Wallet | Nothing can sign an x402 payment. Olai would have to hold a private key, which is the exact thing that makes an autonomous spender unsafe. |
| x402 | Data goes back to monthly subscriptions bought by a human with a card. The itemised cost per decision, the whole point of the ledger, disappears. |
| The Bazaar | The agent has no way to discover what it can buy, so the shopping step becomes a hardcoded list, which is not an agent. |

## The dimension nobody else was competing on

Read from `INTAKE.md` section 2, which scored what a judge would mark and how crowded each row
was. Almost every entry uses the MCP server to trade or read markets: that row is full. Three
rows were close to empty:

1. **Buyer-side x402 and the Agentic Wallet.** Binance built B402, the Bazaar and a wallet skill
   for it, and payments came up in zero of the three usage stories Binance itself featured.
2. **The control and audit story.** Half of every Binance article about Agent OS is about
   control, and the public criticism of agent trading is that keeping agents in check is left to
   users. Entrants use Binance's controls. Almost nobody extends them.
3. **Using more than one Agent OS piece together.** The program page says to combine them. Most
   entries use exactly one.

Olai sits on all three at once. The rulebook is the control story. The x402 buyer with its
settlement hashes is the payment story. The four doors in one two-minute demo is the combination
story.

## The facts that shaped the design

Read from `docs/RD-BRIEF.md` and `INTAKE.md` section 4, and confirmed in the spikes.

- **There is no testnet** for the MCP server or the Agentic Wallet. Every live test against those
  two spends real cents and places real small orders. The exchange REST API is the exception: it
  has its own spot testnet at `https://testnet.binance.vision`, which is why Olai proves its
  trading first there. Dry run stays the default everywhere else, and the rulebook is enforced in
  code rather than in a prompt.
- **The agent cannot fund itself.** It cannot pull money from the owner's main Binance account
  into the sub-account. A human transfers it first.
- **Wallet limits are set in the app, not by the agent.** `baw wallet settings` is read only.
- **Wallet sends only go to addresses already in the owner's address book.**
- **Selling over x402 needs a Binance partner application. Buying needs nothing** but a funded
  wallet. The buyer side was open on day one, which is why Olai is a buyer.
- **The MCP tool names are not published.** They are only visible after connecting. That is why
  `src/mcp/toolmap.ts` resolves names at runtime instead of hardcoding them.
