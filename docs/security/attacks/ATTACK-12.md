# ATTACK-12: sweeping the repo and the git history for secrets

Captured on 2026-09-06T11:15:01.925Z by `npm run attacks -w @olai/agent`. Everything below is
the output of that run, pasted as it came back.

What this attack does NOT prove: that no secret has ever leaked, or that the next commit will be clean. It is a snapshot, and it can only find the five patterns it knows about.

Expected outcome, from docs/security/threat-model.md section 5: no Anthropic key, no owner token and no Binance token anywhere in the tree or the history, .env ignored by git, and .env.example carrying blank placeholders only.

## Step 1

What we tried:

```
Read every file in D:\Projects\Binance and looked for sk-ant, ol., PRIVATE_KEY, MNEMONIC, wallet address.
Skipped: node_modules, .git, reference, spikes, data, dist, coverage, .next, .next-verify, binary file types, files over 2000000 bytes, and .env itself,
which holds the real key, is gitignored, and is checked separately below rather than read.
Files read: 349.

Every match is listed below. A match counts as key material only if the matched text is
an Anthropic key in its published shape, a private key or seed phrase with a value, or a
token that starts with ol. and is long enough to open the API and is not one of these,
which this repo publishes on purpose:
  - the token this attack run boots its own throwaway service with
  - the wrong token ATTACK-14 sends to prove the event stream refuses it
  - a session id with the owner prefix glued on, which is the forgery ATTACK-06 makes and gets a 401 for
  - one character repeated, which is how the tests write a token that is long enough to parse
```

What came back:

```
[ol.] .env.example:7: # "ol." and make it at least 24 characters. Anyone holding it can approve trades.
[ol.] .env.example:8: OLAI_OWNER_TOKEN=ol.
[ol.] docs/security/threat-model.md:168: `OWNER_TOKEN_PREFIX = 'ol.'`, `assertOwnerToken` (checked at boot, refuses to start
[ol.] docs/security/threat-model.md:245: the fact that session ids (`ol-<uuid>`) and the owner token (`ol.` prefix,
[ol.] docs/site/build/assets/js/14107157.2c505138.js:1: "use strict";(self.webpackChunkolai_docs=self.webpackChunkolai_docs||[]).push([["7048"],{1983(e,n,s){s.r(n),s.d(n,{metadata:()=>t,default:()=>h,frontMatter:()=>
[ol.] docs/site/build/assets/js/3592d2f2.c54357e1.js:1: "use strict";(self.webpackChunkolai_docs=self.webpackChunkolai_docs||[]).push([["3833"],{8765(e,n,i){i.r(n),i.d(n,{metadata:()=>t,default:()=>c,frontMatter:()=>
[ol.] docs/site/build/assets/js/588bd741.18053824.js:1: "use strict";(self.webpackChunkolai_docs=self.webpackChunkolai_docs||[]).push([["3925"],{5832(e,n,s){s.r(n),s.d(n,{metadata:()=>t,default:()=>h,frontMatter:()=>
[ol.] docs/site/build/assets/js/da1a8389.e0aaf91b.js:1: "use strict";(self.webpackChunkolai_docs=self.webpackChunkolai_docs||[]).push([["3787"],{4996(e,n,s){s.r(n),s.d(n,{metadata:()=>t,default:()=>c,frontMatter:()=>
[ol.] docs/site/build/concepts/trust-model/index.html:76: <li class="">The token lives in its own namespace: it starts with <code>ol.</code> and is at least 24 characters, while
[ol.] docs/site/build/getting-started/quick-start/index.html:32: <table><thead><tr><th>Key<th>What to put in it<tbody><tr><td><code>ANTHROPIC_API_KEY</code><td>A key from console.anthropic.com. This is the agent's brain.<tr><
[ol.] docs/site/build/security/overview/index.html:43: <li class="">One user, one bearer token, its own <code>ol.</code> namespace, compared in constant time, checked at boot.</li>
[ol.] docs/site/build/security/threat-model/index.html:220: <p><strong>The owner token prefix and constant-time compare.</strong> <code>src/api/auth.ts</code>: the <code>ol.</code> prefix, a
[ol.] docs/site/docs/concepts/trust-model.md:93: - The token lives in its own namespace: it starts with `ol.` and is at least 24 characters, while
[ol.] docs/site/docs/getting-started/quick-start.md:36: | `OLAI_OWNER_TOKEN` | A secret you invent. It has to start with `ol.` and be at least 24 characters. Anyone holding it can approve trades. |
[ol.] docs/site/docs/security/overview.md:51: - One user, one bearer token, its own `ol.` namespace, compared in constant time, checked at boot.
[ol.] docs/site/docs/security/threat-model.md:140: **The owner token prefix and constant-time compare.** `src/api/auth.ts`: the `ol.` prefix, a
[ol.] packages/agent/attacks/attack-06-forged-owner-token.ts:56: const guessedPrefix = await call(harness.base, '/api/ledger', { token: `ol.${sessionId}` });
[ol.] packages/agent/attacks/attack-06-forged-owner-token.ts:70: '401 every time. Session ids (ol-<uuid>) and the owner token (ol. prefix, at least 24 characters, compared by hash in constant time) are separate namespaces on 
[wallet address] packages/agent/attacks/attack-12-secrets-sweep.ts:22: const WALLET_ADDRESS = '0xC75126992E4744a75665405e9b427710C0d23052';
[sk-ant] packages/agent/attacks/attack-12-secrets-sweep.ts:25: { name: 'sk-ant', test: /sk-ant/i },
[ol.] packages/agent/attacks/attack-12-secrets-sweep.ts:28: { name: 'ol.', test: /\bol\./ },
[PRIVATE_KEY] packages/agent/attacks/attack-12-secrets-sweep.ts:29: { name: 'PRIVATE_KEY', test: /PRIVATE_KEY/ },
[MNEMONIC] packages/agent/attacks/attack-12-secrets-sweep.ts:30: { name: 'MNEMONIC', test: /MNEMONIC/ },
[sk-ant] packages/agent/attacks/attack-12-secrets-sweep.ts:42: const ANTHROPIC_KEY = /sk-ant-api\d{2}-[A-Za-z0-9_-]{40,}/;
[PRIVATE_KEY] packages/agent/attacks/attack-12-secrets-sweep.ts:44: const KEY_ASSIGNMENT = /(PRIVATE_KEY|MNEMONIC)\s*[:=]\s*["']?[A-Za-z0-9+/=_-]{16,}/;
[MNEMONIC] packages/agent/attacks/attack-12-secrets-sweep.ts:44: const KEY_ASSIGNMENT = /(PRIVATE_KEY|MNEMONIC)\s*[:=]\s*["']?[A-Za-z0-9+/=_-]{16,}/;
[ol.] packages/agent/attacks/attack-12-secrets-sweep.ts:56: test: (token) => token === 'ol.this-is-not-the-owners-token-at-all',
[ol.] packages/agent/attacks/attack-12-secrets-sweep.ts:201: 'token that starts with ol. and is long enough to open the API and is not one of these,',
[ol.] packages/agent/attacks/attack-12-secrets-sweep.ts:253: 'The other matches above are the word, not the thing: the "ol." prefix constant in the auth',
[ol.] packages/agent/attacks/attack-14-sse-without-token.ts:22: token: 'ol.this-is-not-the-owners-token-at-all',
[ol.] packages/agent/attacks/harness.ts:25: export const OWNER_TOKEN = 'ol.attack-run-token-not-for-production-1';
[ol.] packages/agent/src/api/auth.ts:14: export const OWNER_TOKEN_PREFIX = 'ol.';
[ol.] packages/agent/src/config.ts:29: .string({ error: 'not set, invent a secret that starts with "ol." and put it in .env' })
[ol.] packages/agent/test/api/app.test.ts:25: const TOKEN = `ol.${'k'.repeat(40)}`;
[ol.] packages/agent/test/api/events.test.ts:21: const TOKEN = `ol.${'e'.repeat(40)}`;
[ol.] packages/agent/test/boot/boot.test.ts:19: const TOKEN = `ol.${'b'.repeat(40)}`;
[sk-ant] packages/agent/test/boot/boot.test.ts:58: ANTHROPIC_API_KEY: 'sk-ant-test-key-0123456789',
[ol.] packages/agent/test/config.test.ts:7: const OWNER_TOKEN = `ol.${'t'.repeat(40)}`;
[sk-ant] packages/agent/test/config.test.ts:12: ANTHROPIC_API_KEY: 'sk-ant-test-key-0123456789',
[sk-ant] packages/agent/test/config.test.ts:17: ANTHROPIC_API_KEY: 'sk-ant-test-key-0123456789',
[sk-ant] packages/agent/test/config.test.ts:37: ANTHROPIC_API_KEY: 'sk-ant-test-key-0123456789',
[sk-ant] packages/agent/test/config.test.ts:51: loadConfig({ ANTHROPIC_API_KEY: 'sk-ant-test-key-0123456789', OLAI_OWNER_TOKEN: token });
[ol.] packages/agent/test/config.test.ts:54: expect(() => withToken('ol.short')).toThrowError(/24 characters/);
[wallet address] packages/agent/test/x402/baw.test.ts:65: userWalletAddress: '0xC75126992E4744a75665405e9b427710C0d23052',
[wallet address] packages/agent/test/x402/buyer.test.ts:72: userWalletAddress: '0xC75126992E4744a75665405e9b427710C0d23052',
[ol.] packages/web/src/components/desk/gate.tsx:95: placeholder="ol.…"
[ol.] packages/web/src/components/desk/gate.tsx:121: Set OLAI_OWNER_TOKEN in .env, it starts with ol.
[wallet address] README.md:290: Run on 2026-09-06 with `OLAI_DRY_RUN=false OLAI_PROVE_SPEND=yes`. The receipt for that settlement, read from a BNB Smart Chain node: status success, block 12027
[ol.] README.md:300: | `OLAI_OWNER_TOKEN` | The password to Olai's own API. Must start with `ol.` and be at least 24 characters. Anyone holding it can approve trades. |
[wallet address] STATE.md:27: 3. Fund the Agentic Wallet: about 5 USDT or USD1 on BNB Smart Chain to 0xC75126992E4744a75665405e9b427710C0d23052. Optional: lower the general daily limit in th
[wallet address] STATE.md:55: - Receipt read from a BSC node: status SUCCESS, block 120274603, 0.0100 USDT moved from the Agentic Wallet 0xC75126992E4744a75665405e9b427710C0d23052 to Nansen'
[ol.] STATE.md:57: - Rename to Olai done (WO-13): 1,018 replacements across 138 files, package names @olai/agent and @olai/web, settings prefix OLAI_, token prefix ol., database r
```

## Step 2

What we tried:

```
git log -p --all, then the same patterns over every line of it.
```

What came back:

```
history is 1 lines long

no matches
```

## Step 3

What we tried:

```
git check-ignore -v .env data/olai.db data/binance-mcp-token.json packages/agent/data/olai.db
```

What came back:

```
.gitignore:5:.env	.env
.gitignore:14:data/	data/olai.db
.gitignore:14:data/	data/binance-mcp-token.json
.gitignore:14:data/	packages/agent/data/olai.db
```

## Step 4

What we tried:

```
Read .env.example and listed every setting it carries, with whatever value is filled in.
```

What came back:

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

## Note

The owner's wallet address 0xC75126992E4744a75665405e9b427710C0d23052 appears 6 times, in
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

RESULT: BLOCKED
