# ATTACK-05: editing a ledger row directly in the SQLite file

Captured on 2026-09-06T14:59:29.810Z by `npm run attacks -w @olai/agent`. Everything below is
the output of that run, pasted as it came back.

What this attack does NOT prove: that the ledger cannot be tampered with. It can, by anyone with the file. It proves the tampering is visible afterwards, and only for an attacker who does not also recompute every later hash.

Expected outcome, from docs/security/threat-model.md section 5: GET /api/ledger/verify reports ok false and names the first broken seq, which is the line that was edited.

## Step 1

What we tried:

```
GET http://127.0.0.1:61931/api/ledger/verify
authorization: Bearer ol.attack-run-token-not-for-production-1
```

What came back:

```
HTTP 200
connection: keep-alive
content-length: 22
content-type: application/json
keep-alive: timeout=5
vary: Origin

{"ok":true,"length":2}
```

## Step 2

What we tried:

```
Opened C:\Users\Ram\AppData\Local\Temp\olai-attack-05-ukcEa0\olai.db directly with better-sqlite3, outside the running agent,
and tried to rewrite line 2, which is currently:
{
  "seq": 2,
  "kind": "rulebook.set",
  "payload": "{\"rulebook\":{\"allowLeverage\":false,\"allowShort\":false,\"allowedSymbols\":[\"BNBUSDT\",\"BTCUSDT\",\"ETHUSDT\"],\"cooldownSecondsBetweenOrders\":0,\"drawdownTiers\":[{\"action\":\"halve\",\"lossUsd\":5},{\"action\":\"halt\",\"lossUsd\":10}],\"maxDailyLossUsd\":10,\"maxDataSpendUsdPerCall\":0.05,\"maxDataSpendUsdPerDay\":1,\"maxOrderUsd\":20,\"maxPositionUsdPerSymbol\":5000,\"name\":\"Attack run rulebook\",\"oneSidePerMarket\":true,\"requireApprovalAboveUsd\":0,\"version\":1},\"summary\":\"Rulebook \\\"Attack run rulebook\\\" was set by the owner\"}"
}

UPDATE ledger SET payload = '{"summary":"Rulebook \"Something the owner never wrote\" was set by the owner"}' WHERE seq = 2
```

What came back:

```
SqliteError: the ledger is append only, a line cannot be changed
```

## Step 3

What we tried:

```
DROP TRIGGER ledger_no_update;
UPDATE ledger SET payload = '{"summary":"Rulebook \"Something the owner never wrote\" was set by the owner"}' WHERE seq = 2
```

What came back:

```
rows changed: 1

line 2 now reads:
{
  "seq": 2,
  "kind": "rulebook.set",
  "payload": "{\"summary\":\"Rulebook \\\"Something the owner never wrote\\\" was set by the owner\"}"
}
```

## Step 4

What we tried:

```
GET http://127.0.0.1:61931/api/ledger/verify
authorization: Bearer ol.attack-run-token-not-for-production-1
```

What came back:

```
HTTP 200
connection: keep-alive
content-length: 111
content-type: application/json
keep-alive: timeout=5
vary: Origin

{"ok":false,"brokenAtSeq":2,"reason":"the stored hash does not match the contents of this line, it was edited"}
```

RESULT: BLOCKED
