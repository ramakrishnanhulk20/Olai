# ATTACK-13: a CORS preflight from https://evil.example

Captured on 2026-09-06T11:15:01.925Z by `npm run attacks -w @olai/agent`. Everything below is
the output of that run, pasted as it came back.

What this attack does NOT prove: that another site cannot call this API. CORS is enforced by browsers, not by the server. Anything holding the owner token can call it from anywhere, which is why the token is the real control.

Expected outcome, from docs/security/threat-model.md section 5: no Access-Control-Allow-Origin header on the answer, so a browser refuses to hand the response to the page. The dashboard origin, and only that one, gets the header.

## Step 1

What we tried:

```
OPTIONS http://127.0.0.1:61253/api/rulebook
origin: https://evil.example
access-control-request-method: PUT
access-control-request-headers: authorization, content-type
```

What came back:

```
HTTP 204
access-control-allow-headers: Authorization,Content-Type
access-control-allow-methods: GET,POST,PUT,OPTIONS
connection: keep-alive
keep-alive: timeout=5
vary: Origin, Access-Control-Request-Headers

(empty body)
```

## Step 2

What we tried:

```
The same preflight from the one origin the config does allow, for contrast:

OPTIONS http://127.0.0.1:61253/api/rulebook
origin: http://localhost:3000
access-control-request-method: PUT
access-control-request-headers: authorization, content-type
```

What came back:

```
HTTP 204
access-control-allow-headers: Authorization,Content-Type
access-control-allow-methods: GET,POST,PUT,OPTIONS
access-control-allow-origin: http://localhost:3000
connection: keep-alive
keep-alive: timeout=5
vary: Origin, Access-Control-Request-Headers

(empty body)
```

## Step 3

What we tried:

```
A real read from the same origin, with the owner token, to show what CORS does and does not do:

GET http://127.0.0.1:61253/api/rulebook
origin: https://evil.example
authorization: Bearer ol.attack-run-token-not-for-production-1
```

What came back:

```
HTTP 200
connection: keep-alive
content-length: 423
content-type: application/json
keep-alive: timeout=5
vary: Origin

{"version":1,"name":"Olai starter rulebook","maxOrderUsd":20,"maxDailyLossUsd":10,"maxPositionUsdPerSymbol":50,"allowedSymbols":["BNBUSDT","BTCUSDT","ETHUSDT"],"allowShort":false,"allowLeverage":false,"maxDataSpendUsdPerDay":1,"maxDataSpendUsdPerCall":0.05,"cooldownSecondsBetweenOrders":60,"requireApprovalAboveUsd":0,"oneSidePerMarket":true,"drawdownTiers":[{"lossUsd":5,"action":"halve"},{"lossUsd":10,"action":"halt"}]}
```

RESULT: BLOCKED
