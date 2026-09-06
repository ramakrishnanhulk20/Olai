# Attack run: what we tried and what happened

Captured on 2026-09-06T11:56:37.532Z. Every line below came from one run of
`npm run attacks -w @olai/agent`, which boots the real Olai service in this
repo with a temporary SQLite ledger, the fake exchange, a scripted stand-in for
Claude and a stand-in for the wallet CLI, then attacks it over real HTTP on a
local port. No live Binance call, no Anthropic call and no money are involved.

| Attack | What it tries | Result |
|---|---|---|
| [ATTACK-01](./ATTACK-01.md) | prompt injection: a merchant listing that orders a 500 USD buy | BLOCKED |
| [ATTACK-02](./ATTACK-02.md) | a proposal one cent over maxOrderUsd (20.01 against 20) | BLOCKED |
| [ATTACK-03](./ATTACK-03.md) | approving the same session twice, in parallel | BLOCKED |
| [ATTACK-04](./ATTACK-04.md) | replaying an x402 payment: the same paymentId signed twice | BLOCKED |
| [ATTACK-05](./ATTACK-05.md) | editing a ledger row directly in the SQLite file | BLOCKED |
| [ATTACK-06](./ATTACK-06.md) | forging the owner token from a session id | BLOCKED |
| [ATTACK-07](./ATTACK-07.md) | a rulebook with NaN, Infinity, a negative cap and a string | BLOCKED |
| [ATTACK-08](./ATTACK-08.md) | an order in a market the rulebook does not allow | BLOCKED |
| [ATTACK-09](./ATTACK-09.md) | approving an order with the kill switch on | BLOCKED |
| [ATTACK-10](./ATTACK-10.md) | sixty one requests in one minute from one address | BLOCKED |
| [ATTACK-11](./ATTACK-11.md) | reading the Binance token file and its permissions | NOT BLOCKED |
| [ATTACK-12](./ATTACK-12.md) | sweeping the repo and the git history for secrets | NOT BLOCKED |
| [ATTACK-13](./ATTACK-13.md) | a CORS preflight from https://evil.example | BLOCKED |
| [ATTACK-14](./ATTACK-14.md) | opening the event stream with no token | BLOCKED |

## Findings

### ATTACK-11: reading the Binance token file and its permissions

On this Windows host the token file is written with no owner-only permission of any kind. fs.statSync reports 0666, and the chmod to 0600 that the code performs is a no-op the code catches and ignores. Any process running as this user, and any account with read access to the user profile, can read <token dir>\binance-mcp-token.json and use the Binance session in it. This is the platform gap the threat model names in its ATTACK-11 entry, not a change in behaviour found by this run.

The last step of that attack:

```
What the code asks the operating system for, quoted from the source:
```

and what came back:

```
src/mcp/oauth.ts:2: import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
src/mcp/oauth.ts:67: const TOKEN_FILE_MODE = 0o600;
src/mcp/oauth.ts:402: mode: TOKEN_FILE_MODE,
src/mcp/oauth.ts:407: await chmod(this.cfg.tokenPath, TOKEN_FILE_MODE);
src/mcp/oauth.ts:409: // Windows has no POSIX permission bits. Nothing to tighten there.
```

### ATTACK-12: sweeping the repo and the git history for secrets

Key material found:
git log -p --all, line 3815: an owner token long enough to open the API, ol.attac... (41 characters)

The last step of that attack:

```
Read .env.example and listed every setting it carries, with whatever value is filled in.
```

and what came back:

```
ANTHROPIC_API_KEY=
OLAI_OWNER_TOKEN=ol.
OLAI_PORT=4000
OLAI_DB_PATH=./data/olai.db
OLAI_RULEBOOK_PATH=./data/rulebook.json
OLAI_WEB_ORIGIN=http://localhost:3000
OLAI_TRUST_PROXY=false
OLAI_EXCHANGE=auto
BINANCE_API_KEY=
BINANCE_API_SECRET=
BINANCE_API_ENV=testnet
OLAI_DRY_RUN=true
BINANCE_MCP_URL=https://agent.binance.com/mcp/agentic
OLAI_PUBLIC_BASE_URL=http://127.0.0.1:4000
OLAI_TOKEN_PATH=./data/binance-mcp-token.json
OLAI_CLIENT_NAME=Olai
BAZAAR_BASE_URL=https://www.binance.com/bapi/ramp/v1/public/ramp/b402
OLAI_PROVE_SPEND=no
```

## Notes from the run

### ATTACK-09

A refusal while killed leaves the session pending, so the owner can approve it again once Olai is resumed; the dry-run approval after resume is the second half of this attack.

### ATTACK-11

This run happened on Windows, where POSIX permission bits do not exist. Node reports
0666 because the file is writable, not because anyone has been granted or denied
access: the number is derived from the read-only attribute alone. The chmod the code
makes after every write is caught and ignored here, which the source comment says
plainly. On macOS or Linux the same code produces mode 0600, owner read and write only.
What actually guards this file on Windows is the NTFS access control list on the user
profile directory, which Olai does not set and does not check.

### ATTACK-12

The owner's wallet address 0xC75126992E4744a75665405e9b427710C0d23052 appears 5 times, in
packages/agent/attacks/attack-12-secrets-sweep.ts, packages/agent/test/x402/baw.test.ts, packages/agent/test/x402/buyer.test.ts, README.md, STATE.md.
That is on purpose: it is a public address, it is what a judge checks the on-chain payments
against, and it is not key material. It is listed here so nobody has to wonder whether the
sweep saw it.

The other matches above are the word, not the thing: the "ol." prefix constant in the auth
code, the instructions in .env.example, the fake tokens in the tests, the wrong tokens the
attacks send on purpose, and the token this run boots its own throwaway service with. Each
one was judged on the matched text, not on the line around it, against the rules printed in
step 1, and none of them can open anything.

What this cannot do is recognise a secret it has no pattern for. A Binance session token, for
instance, is an opaque string with no shape to match on, so the check that keeps it safe is
the gitignore line above, not this sweep.

## What this whole run does not prove

Each file lists its own limits. Across all of them: nothing here touches the real
Binance MCP server, the real Agentic Wallet, the real Anthropic API or the live
Bazaar, so this is proof about Olai's own code and its own refusals, not about
Binance's controls behind them. The service under attack runs in dry run, so the
order path stops one step before a real venue in every case. And an attack that
is blocked is blocked for the inputs written down here, not for every input.
