---
title: Audits
sidebar_position: 3
description: Olai is self-audited. This page says exactly how, and where the executed attack output lives.
---

# Audits

## Olai is self-audited

No external security firm has reviewed this code. No automated static-analysis tool has run
against it. There is no audit report from a third party and there is no bug bounty. Anyone
telling you otherwise is reading a different project.

What "self-audited" means here, precisely:

1. **Every file under `packages/agent/src` was read line by line** against the running rulebook,
   ledger, session and x402 code, alongside `PLAN.md`, `INTAKE.md` and `docs/RD-BRIEF.md`. The
   result is the [threat model](./threat-model.md): assets, attackers, every entry point, the
   controls mapped to the exact function that implements each one, and the weaknesses we did not
   fix.
2. **Every claim in that threat model has an attack script**, and the scripts were executed rather
   than reasoned about. The output is saved in the repository.
3. **The gaps are named in the same document as the controls.** Section 6 of the threat model
   lists eleven weaknesses, including the ones that are awkward to admit: daily loss counts
   unrealised price moves, some guards are in memory only, merchant text is trusted as data after
   schema validation, and the model writes its own account of what it bought.

## The executed attack scripts

The scripts and their saved output live in `docs/security/attacks/` in the repository. These are
executed attack scripts with saved output, not a list of things we intend to try.

The fourteen attacks are listed in section 5 of the [threat model](./threat-model.md), with the
expected result and the control each one is aimed at. In summary they cover:

- **The rulebook.** Prompt injection through a merchant response, an order above the size limit, a
  symbol that is not on the allow list, and a rulebook containing NaN.
- **Double spending.** Approving the same session twice, and replaying an x402 signature.
- **The record.** Editing a ledger row directly in the SQLite file, which the chain check must
  report by sequence number.
- **The door.** Forging the owner token from a session id, and pushing past the rate limit from a
  second address.
- **The machine.** The permissions on the OAuth token file, which are `0600` on POSIX and a
  documented no-op on Windows, and a grep of the repository and its git history for keys, tokens
  and seed phrases.
- **The stop.** Kill, then approve.

Two things to know when reading the output. First, an attack that reads BLOCKED means the control
refused it: a refusal is the good result. Second, the run is honest about what it found. The
first run reported ATTACK-03 NOT BLOCKED: two approvals of the same session sent in parallel
produced two order lines, because the claim on the session was taken after an awaited account
read. That race was fixed in `src/session/session.ts` with a per-session in-flight promise, a
test was added, and the re-run reports it BLOCKED. The current run is 14 attacks, 13 blocked,
and one recorded weakness: on a Windows host the token file's 0600 mode is a no-op because NTFS
ignores POSIX bits, so ATTACK-11 stays NOT BLOCKED there and the threat model says so.

## What the tests cover, and what they do not

The test suite under `packages/agent/test` covers the rulebook engine rule by rule with worked
examples and property-based invariants, the ledger's hash chain and its append-only triggers, the
API's routes and auth and rate limiter, the MCP client over an in-memory transport, the OAuth
PKCE and state checks against a fake authorization server, the tool-name resolver, the `baw` CLI
wrapper's parsing, and a recorded real 402 paid through a scripted wallet.

What the suite does not cover: the live Binance MCP server's real tool names and response shapes,
the behaviour of the real Anthropic API in a long tool loop, and any merchant that is not one of
the two with recorded responses. Those are exercised by `npm run prove` against the live network,
not by unit tests.

## What a third-party audit would add

Named honestly, because the difference matters:

- Independent verification that the rulebook engine's refusal logic cannot be bypassed by an input
  shape we did not consider.
- A timing analysis of the owner-token compare beyond the constant-time hash compare already in
  place.
- A review of the subprocess boundary in `src/x402/baw.ts` beyond the no-shell, argument-array
  mitigation already coded.
- A live penetration test of the OAuth flow against Binance's actual authorization server, rather
  than against the code path alone.

Until those exist, read the threat model, run the attack scripts yourself, and run
`GET /api/ledger/verify` on your own ledger. Every claim on this site is meant to be one you can
check.
