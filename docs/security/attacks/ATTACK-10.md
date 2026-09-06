# ATTACK-10: sixty one requests in one minute from one address

Captured on 2026-09-06T14:59:29.810Z by `npm run attacks -w @olai/agent`. Everything below is
the output of that run, pasted as it came back.

What this attack does NOT prove: that the limit stops a real attacker. It counts per address, so more machines means more requests, and the threat model lists that as a known limit rather than a bypass. Nothing here weakens the owner-token check, which every one of these requests still had to pass.

Expected outcome, from docs/security/threat-model.md section 5: the first 60 answered and the next one refused with 429 and a Retry-After header.

## Step 1

What we tried:

```
61 requests to GET /api/rulebook from one socket, one after another, all with the owner token.
The limit in src/api/auth.ts is 60 requests per 60 seconds, counted per address.
```

What came back:

```
all 61 sent in 42 ms
HTTP 200: 60
HTTP 429: 1
last one allowed: request 60: HTTP 200
first one refused: request 61
```

## Step 2

What we tried:

```
GET http://127.0.0.1:62495/api/rulebook
authorization: Bearer ol.attack-run-token-not-for-production-1
```

What came back:

```
HTTP 429
connection: keep-alive
content-length: 69
content-type: application/json
keep-alive: timeout=5
retry-after: 60
vary: Origin

{"error":"too many requests, wait 60 seconds","retryAfterSeconds":60}
```

RESULT: BLOCKED
