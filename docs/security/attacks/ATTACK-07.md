# ATTACK-07: a rulebook with NaN, Infinity, a negative cap and a string

Captured on 2026-09-07T12:14:01.325Z by `npm run attacks -w @olai/agent`. Everything below is
the output of that run, pasted as it came back.

What this attack does NOT prove: that a rulebook which passes the schema is a safe one. The owner can legitimately save loose rules. This is only about shapes that would break the arithmetic.

Expected outcome, from docs/security/threat-model.md section 5: 400 on each attempt and the stored rulebook untouched. NaN and Infinity are not valid JSON, so those two are refused before the schema is even reached; the negative number and the string are refused by rulebookSchema in src/policy/rulebook.ts.

## Step 1

What we tried:

```
GET http://127.0.0.1:54489/api/rulebook
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

## Step 2

What we tried:

```
PUT http://127.0.0.1:54489/api/rulebook
content-type: application/json
authorization: Bearer ol.attack-run-token-not-for-production-1

{"version":1,"name":"Olai starter rulebook","maxOrderUsd":NaN,"maxDailyLossUsd":10,"maxPositionUsdPerSymbol":50,"allowedSymbols":["BNBUSDT","BTCUSDT","ETHUSDT"],"allowShort":false,"allowLeverage":false,"maxDataSpendUsdPerDay":1,"maxDataSpendUsdPerCall":0.05,"cooldownSecondsBetweenOrders":60,"requireApprovalAboveUsd":0,"oneSidePerMarket":true,"drawdownTiers":[{"lossUsd":5,"action":"halve"},{"lossUsd":10,"action":"halt"}]}
```

What came back:

```
HTTP 400
connection: keep-alive
content-length: 46
content-type: application/json
keep-alive: timeout=5
vary: Origin

{"error":"the request body is not valid JSON"}
```

## Step 3

What we tried:

```
PUT http://127.0.0.1:54489/api/rulebook
content-type: application/json
authorization: Bearer ol.attack-run-token-not-for-production-1

{"version":1,"name":"Olai starter rulebook","maxOrderUsd":Infinity,"maxDailyLossUsd":10,"maxPositionUsdPerSymbol":50,"allowedSymbols":["BNBUSDT","BTCUSDT","ETHUSDT"],"allowShort":false,"allowLeverage":false,"maxDataSpendUsdPerDay":1,"maxDataSpendUsdPerCall":0.05,"cooldownSecondsBetweenOrders":60,"requireApprovalAboveUsd":0,"oneSidePerMarket":true,"drawdownTiers":[{"lossUsd":5,"action":"halve"},{"lossUsd":10,"action":"halt"}]}
```

What came back:

```
HTTP 400
connection: keep-alive
content-length: 46
content-type: application/json
keep-alive: timeout=5
vary: Origin

{"error":"the request body is not valid JSON"}
```

## Step 4

What we tried:

```
PUT http://127.0.0.1:54489/api/rulebook
content-type: application/json
authorization: Bearer ol.attack-run-token-not-for-production-1

{"version":1,"name":"Olai starter rulebook","maxOrderUsd":-1,"maxDailyLossUsd":10,"maxPositionUsdPerSymbol":50,"allowedSymbols":["BNBUSDT","BTCUSDT","ETHUSDT"],"allowShort":false,"allowLeverage":false,"maxDataSpendUsdPerDay":1,"maxDataSpendUsdPerCall":0.05,"cooldownSecondsBetweenOrders":60,"requireApprovalAboveUsd":0,"oneSidePerMarket":true,"drawdownTiers":[{"lossUsd":5,"action":"halve"},{"lossUsd":10,"action":"halt"}]}
```

What came back:

```
HTTP 400
connection: keep-alive
content-length: 182
content-type: application/json
keep-alive: timeout=5
vary: Origin

{"error":"that rulebook is not one Olai can run","issues":[{"origin":"number","code":"too_small","minimum":0,"inclusive":true,"path":["maxOrderUsd"],"message":"cannot be negative"}]}
```

## Step 5

What we tried:

```
PUT http://127.0.0.1:54489/api/rulebook
content-type: application/json
authorization: Bearer ol.attack-run-token-not-for-production-1

{"version":1,"name":"Olai starter rulebook","maxOrderUsd":"20","maxDailyLossUsd":10,"maxPositionUsdPerSymbol":50,"allowedSymbols":["BNBUSDT","BTCUSDT","ETHUSDT"],"allowShort":false,"allowLeverage":false,"maxDataSpendUsdPerDay":1,"maxDataSpendUsdPerCall":0.05,"cooldownSecondsBetweenOrders":60,"requireApprovalAboveUsd":0,"oneSidePerMarket":true,"drawdownTiers":[{"lossUsd":5,"action":"halve"},{"lossUsd":10,"action":"halt"}]}
```

What came back:

```
HTTP 400
connection: keep-alive
content-length: 187
content-type: application/json
keep-alive: timeout=5
vary: Origin

{"error":"that rulebook is not one Olai can run","issues":[{"expected":"number","code":"invalid_type","path":["maxOrderUsd"],"message":"Invalid input: expected number, received string"}]}
```

## Step 6

What we tried:

```
The rulebook the service is actually running, read back after all four attempts:

GET http://127.0.0.1:54489/api/rulebook
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
