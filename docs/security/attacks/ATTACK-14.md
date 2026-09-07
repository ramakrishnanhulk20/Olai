# ATTACK-14: opening the event stream with no token

Captured on 2026-09-07T12:14:01.325Z by `npm run attacks -w @olai/agent`. Everything below is
the output of that run, pasted as it came back.

What this attack does NOT prove: that the feed is private after a client is on it. Everything published goes to every subscriber, since there is one owner. The OAuth routes outside /api are not covered here either.

Expected outcome, from docs/security/threat-model.md section 5: 401, from ownerAuth in src/api/auth.ts, before the stream is ever opened.

## Step 1

What we tried:

```
GET http://127.0.0.1:54504/api/events
accept: text/event-stream
```

What came back:

```
HTTP 401
connection: keep-alive
content-length: 70
content-type: application/json
keep-alive: timeout=5
vary: Origin

{"error":"this API belongs to one owner and that token is not theirs"}
```

## Step 2

What we tried:

```
GET http://127.0.0.1:54504/api/events
accept: text/event-stream
authorization: Bearer ol.this-is-not-the-owners-token-at-all
```

What came back:

```
HTTP 401
connection: keep-alive
content-length: 70
content-type: application/json
keep-alive: timeout=5
vary: Origin

{"error":"this API belongs to one owner and that token is not theirs"}
```

## Step 3

What we tried:

```
The real token with one extra character on the end, in case the compare is a prefix compare:

GET http://127.0.0.1:54504/api/events
accept: text/event-stream
authorization: Bearer ol.attack-run-token-not-for-production-1x
```

What came back:

```
HTTP 401
connection: keep-alive
content-length: 70
content-type: application/json
keep-alive: timeout=5
vary: Origin

{"error":"this API belongs to one owner and that token is not theirs"}
```

RESULT: BLOCKED
