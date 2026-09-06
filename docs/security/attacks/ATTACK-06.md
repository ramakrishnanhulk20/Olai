# ATTACK-06: forging the owner token from a session id

Captured on 2026-09-06T12:12:35.109Z by `npm run attacks -w @olai/agent`. Everything below is
the output of that run, pasted as it came back.

What this attack does NOT prove: that the owner token is safe from theft. It is a bearer token: whoever holds it is the owner. This only shows that a session id is not one.

Expected outcome, from docs/security/threat-model.md section 5: 401 every time. Session ids (ol-<uuid>) and the owner token (ol. prefix, at least 24 characters, compared by hash in constant time) are separate namespaces on purpose.

## Step 1

What we tried:

```
GET http://127.0.0.1:55062/api/sessions
authorization: Bearer ol.attack-run-token-not-for-production-1
```

What came back:

```
HTTP 200
connection: keep-alive
content-length: 405
content-type: application/json
keep-alive: timeout=5
vary: Origin

[{"id":"ol-99d04b2d63444a74b231885bbe2a28fe","question":"Anything worth doing in BNB today?","createdAt":"2026-09-06T12:12:35.777Z","status":"approved","proposal":{"summary":"Sit this one out.","reasoning":"Nothing in the free reads argues for a trade right now.","action":{"type":"hold","reason":"The evidence is thin."},"confidence":0.4,"dataUsed":[],"risks":["Missing a move if it runs without me."]}}]
```

## Step 2

What we tried:

```
Take the session id from the list above and send it as the bearer token.

GET http://127.0.0.1:55062/api/ledger
authorization: Bearer ol-99d04b2d63444a74b231885bbe2a28fe
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
POST http://127.0.0.1:55062/api/sessions/ol-99d04b2d63444a74b231885bbe2a28fe/approve
authorization: Bearer ol-99d04b2d63444a74b231885bbe2a28fe
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

## Step 4

What we tried:

```
The same id with the owner prefix glued on the front, in case the prefix is all that is checked.

GET http://127.0.0.1:55062/api/ledger
authorization: Bearer ol.ol-99d04b2d63444a74b231885bbe2a28fe
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
