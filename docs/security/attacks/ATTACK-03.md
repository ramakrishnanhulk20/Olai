# ATTACK-03: approving the same session twice, in parallel

Captured on 2026-09-06T14:59:29.810Z by `npm run attacks -w @olai/agent`. Everything below is
the output of that run, pasted as it came back.

What this attack does NOT prove: that a restart between the two approvals is safe. The guard lives in memory, which the threat model records as gap 6.2. Nor does it prove anything about the live venue: this run stops at the dry-run branch, so an order.sent line is the closest thing to an order there is here.

Expected outcome, from docs/security/threat-model.md section 5: one order.sent line in the ledger, and the second call returning the record that already executed rather than sending again.

## Step 1

What we tried:

```
POST http://127.0.0.1:61924/api/ask
content-type: application/json
authorization: Bearer ol.attack-run-token-not-for-production-1

{"question":"Should I add a little BNB?"}
```

What came back:

```
HTTP 200
connection: keep-alive
content-length: 579
content-type: application/json
keep-alive: timeout=5
vary: Origin

{"id":"ol-166dcf08ae8446bda4d38cdd58647757","question":"Should I add a little BNB?","createdAt":"2026-09-06T14:59:30.245Z","status":"pending","proposal":{"summary":"Add 12 dollars of BNB.","reasoning":"Small size, deep book.","action":{"type":"order","symbol":"BNBUSDT","side":"BUY","quoteUsd":12,"orderType":"MARKET"},"confidence":0.6,"dataUsed":[],"risks":["A weekend gap would hurt this."]},"verdict":{"allowed":true,"requiresApproval":true,"effectiveMaxOrderUsd":20,"reasons":["This order is above $0.00, so the owner has to approve it."],"ruleIds":["order.needs_approval"]}}
```

## Step 2

What we tried:

```
Two approvals of the same session, fired together with Promise.all, each on its own
connection so the server really has both in flight at once:

POST http://127.0.0.1:61924/api/sessions/ol-166dcf08ae8446bda4d38cdd58647757/approve
authorization: Bearer ol.attack-run-token-not-for-production-1

POST http://127.0.0.1:61924/api/sessions/ol-166dcf08ae8446bda4d38cdd58647757/approve
authorization: Bearer ol.attack-run-token-not-for-production-1
```

What came back:

```
First answer:
HTTP 200
connection: close
content-length: 580
content-type: application/json
vary: Origin

{"id":"ol-166dcf08ae8446bda4d38cdd58647757","question":"Should I add a little BNB?","createdAt":"2026-09-06T14:59:30.245Z","status":"executed","proposal":{"summary":"Add 12 dollars of BNB.","reasoning":"Small size, deep book.","action":{"type":"order","symbol":"BNBUSDT","side":"BUY","quoteUsd":12,"orderType":"MARKET"},"confidence":0.6,"dataUsed":[],"risks":["A weekend gap would hurt this."]},"verdict":{"allowed":true,"requiresApproval":true,"effectiveMaxOrderUsd":20,"reasons":["This order is above $0.00, so the owner has to approve it."],"ruleIds":["order.needs_approval"]}}

Second answer:
HTTP 200
connection: close
content-length: 580
content-type: application/json
vary: Origin

{"id":"ol-166dcf08ae8446bda4d38cdd58647757","question":"Should I add a little BNB?","createdAt":"2026-09-06T14:59:30.245Z","status":"executed","proposal":{"summary":"Add 12 dollars of BNB.","reasoning":"Small size, deep book.","action":{"type":"order","symbol":"BNBUSDT","side":"BUY","quoteUsd":12,"orderType":"MARKET"},"confidence":0.6,"dataUsed":[],"risks":["A weekend gap would hurt this."]},"verdict":{"allowed":true,"requiresApproval":true,"effectiveMaxOrderUsd":20,"reasons":["This order is above $0.00, so the owner has to approve it."],"ruleIds":["order.needs_approval"]}}
```

## Step 3

What we tried:

```
GET http://127.0.0.1:61924/api/ledger?sessionId=ol-166dcf08ae8446bda4d38cdd58647757
authorization: Bearer ol.attack-run-token-not-for-production-1
```

What came back:

```
HTTP 200
connection: keep-alive
content-length: 2317
content-type: application/json
keep-alive: timeout=5
vary: Origin

{"entries":[{"seq":3,"ts":"2026-09-06T14:59:30.245Z","kind":"question","actor":"owner","payload":{"question":"Should I add a little BNB?"},"sessionId":"ol-166dcf08ae8446bda4d38cdd58647757","prevHash":"47e277ed6e928902ec25c3e15dbdbbaaaffe35b87101c6a9540b1334a8111c20","hash":"12f0724f96a30bd5d3912d8d0fd64ba369bdf391638acd8c2887613d3b7601e3"},{"seq":5,"ts":"2026-09-06T14:59:30.247Z","kind":"proposal","actor":"agent","payload":{"action":{"orderType":"MARKET","quoteUsd":12,"side":"BUY","symbol":"BNBUSDT","type":"order"},"confidence":0.6,"dataUsed":[],"reasoning":"Small size, deep book.","risks":["A weekend gap would hurt this."],"summary":"Add 12 dollars of BNB."},"sessionId":"ol-166dcf08ae8446bda4d38cdd58647757","prevHash":"de44c8f055a14d7f1e174a37425413deb3b89a7a9e0c7d0a046cc95728cbe1f6","hash":"d4eeb9f3d50d16c720abed0f6987a143a1b3504d431fe710882a659044409272"},{"seq":6,"ts":"2026-09-06T14:59:30.248Z","kind":"proposal","actor":"agent","payload":{"action":{"orderType":"MARKET","quoteUsd":12,"side":"BUY","symbol":"BNBUSDT","type":"order"},"ruleIds":["order.needs_approval"],"summary":"Proposal passed the rulebook and is waiting for the owner"},"sessionId":"ol-166dcf08ae8446bda4d38cdd58647757","prevHash":"d4eeb9f3d50d16c720abed0f6987a143a1b3504d431fe710882a659044409272","hash":"13fe59f81c49f84483a4bdd702dea6158e3e76035fa15a21a2bf3d45d22df24d"},{"seq":7,"ts":"2026-09-06T14:59:30.254Z","kind":"approval","actor":"owner","payload":{"action":{"orderType":"MARKET","quoteUsd":12,"side":"BUY","symbol":"BNBUSDT","type":"order"},"summary":"Owner approved BUY BNBUSDT"},"sessionId":"ol-166dcf08ae8446bda4d38cdd58647757","prevHash":"13fe59f81c49f84483a4bdd702dea6158e3e76035fa15a21a2bf3d45d22df24d","hash":"9244f0cd95855d0260964435d77dc464534282645d94b328954e480f8670e02c"},{"seq":8,"ts":"2026-09-06T14:59:30.255Z","kind":"order.sent","actor":"agent","payload":{"action":{"orderType":"MARKET","quoteUsd":12,"side":"BUY","symbol":"BNBUSDT","type":"order"},"dryRun":true,"summary":"Dry run: BUY BNBUSDT for 12 USD was not sent to Binance"},"orderId":"ol-166dcf08ae8446bda4d38cdd58647757","sessionId":"ol-166dcf08ae8446bda4d38cdd58647757","prevHash":"9244f0cd95855d0260964435d77dc464534282645d94b328954e480f8670e02c","hash":"d69f9c6279ac61695ace20b85303fe7163b04587a8b70851d1fc460aa472d06c"}],"nextAfterSeq":null}
```

## Step 4

What we tried:

```
A second pending session, and both approvals started in the same tick, which is what
two clicks or a client retry look like when the account read in the middle of the
approval is a real network call:

await Promise.all([runner.approve("ol-f97c4c0e5ec94b4a8fab21229ba7848c"), runner.approve("ol-f97c4c0e5ec94b4a8fab21229ba7848c")])
```

What came back:

```
returned statuses: ["executed","executed"]
approval lines in the ledger for this session: 1
order.sent lines in the ledger for this session: 1

seq 12 approval: Owner approved BUY BNBUSDT
seq 13 order.sent: Dry run: BUY BNBUSDT for 12 USD was not sent to Binance
```

RESULT: BLOCKED
