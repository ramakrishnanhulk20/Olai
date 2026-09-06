# ATTACK-03: approving the same session twice, in parallel

Captured on 2026-09-06T11:56:37.532Z by `npm run attacks -w @olai/agent`. Everything below is
the output of that run, pasted as it came back.

What this attack does NOT prove: that a restart between the two approvals is safe. The guard lives in memory, which the threat model records as gap 6.2. Nor does it prove anything about the live venue: this run stops at the dry-run branch, so an order.sent line is the closest thing to an order there is here.

Expected outcome, from docs/security/threat-model.md section 5: one order.sent line in the ledger, and the second call returning the record that already executed rather than sending again.

## Step 1

What we tried:

```
POST http://127.0.0.1:61964/api/ask
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

{"id":"ol-946b4f24ba664935bcc704906b98653c","question":"Should I add a little BNB?","createdAt":"2026-09-06T11:56:38.233Z","status":"pending","proposal":{"summary":"Add 12 dollars of BNB.","reasoning":"Small size, deep book.","action":{"type":"order","symbol":"BNBUSDT","side":"BUY","quoteUsd":12,"orderType":"MARKET"},"confidence":0.6,"dataUsed":[],"risks":["A weekend gap would hurt this."]},"verdict":{"allowed":true,"requiresApproval":true,"effectiveMaxOrderUsd":20,"reasons":["This order is above $0.00, so the owner has to approve it."],"ruleIds":["order.needs_approval"]}}
```

## Step 2

What we tried:

```
Two approvals of the same session, fired together with Promise.all, each on its own
connection so the server really has both in flight at once:

POST http://127.0.0.1:61964/api/sessions/ol-946b4f24ba664935bcc704906b98653c/approve
authorization: Bearer ol.attack-run-token-not-for-production-1

POST http://127.0.0.1:61964/api/sessions/ol-946b4f24ba664935bcc704906b98653c/approve
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

{"id":"ol-946b4f24ba664935bcc704906b98653c","question":"Should I add a little BNB?","createdAt":"2026-09-06T11:56:38.233Z","status":"executed","proposal":{"summary":"Add 12 dollars of BNB.","reasoning":"Small size, deep book.","action":{"type":"order","symbol":"BNBUSDT","side":"BUY","quoteUsd":12,"orderType":"MARKET"},"confidence":0.6,"dataUsed":[],"risks":["A weekend gap would hurt this."]},"verdict":{"allowed":true,"requiresApproval":true,"effectiveMaxOrderUsd":20,"reasons":["This order is above $0.00, so the owner has to approve it."],"ruleIds":["order.needs_approval"]}}

Second answer:
HTTP 200
connection: close
content-length: 580
content-type: application/json
vary: Origin

{"id":"ol-946b4f24ba664935bcc704906b98653c","question":"Should I add a little BNB?","createdAt":"2026-09-06T11:56:38.233Z","status":"executed","proposal":{"summary":"Add 12 dollars of BNB.","reasoning":"Small size, deep book.","action":{"type":"order","symbol":"BNBUSDT","side":"BUY","quoteUsd":12,"orderType":"MARKET"},"confidence":0.6,"dataUsed":[],"risks":["A weekend gap would hurt this."]},"verdict":{"allowed":true,"requiresApproval":true,"effectiveMaxOrderUsd":20,"reasons":["This order is above $0.00, so the owner has to approve it."],"ruleIds":["order.needs_approval"]}}
```

## Step 3

What we tried:

```
GET http://127.0.0.1:61964/api/ledger?sessionId=ol-946b4f24ba664935bcc704906b98653c
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

{"entries":[{"seq":3,"ts":"2026-09-06T11:56:38.233Z","kind":"question","actor":"owner","payload":{"question":"Should I add a little BNB?"},"sessionId":"ol-946b4f24ba664935bcc704906b98653c","prevHash":"b8bf3a9baf2989f522beeaf94da0a7de9d6fb7d75412d0bf374e0aaacca397bc","hash":"2155be9b01e42628f67f3b7ac800d72013517d3e9f8aef8e5ef0afbb7c76f012"},{"seq":5,"ts":"2026-09-06T11:56:38.235Z","kind":"proposal","actor":"agent","payload":{"action":{"orderType":"MARKET","quoteUsd":12,"side":"BUY","symbol":"BNBUSDT","type":"order"},"confidence":0.6,"dataUsed":[],"reasoning":"Small size, deep book.","risks":["A weekend gap would hurt this."],"summary":"Add 12 dollars of BNB."},"sessionId":"ol-946b4f24ba664935bcc704906b98653c","prevHash":"c7400efdfe962ee1c86f53166092d374481e6949b39e42dcbef242b699602664","hash":"ab0a9a807c324935cb86dd3eeb7096e692d01422b8516effa975ed64af3975ed"},{"seq":6,"ts":"2026-09-06T11:56:38.236Z","kind":"proposal","actor":"agent","payload":{"action":{"orderType":"MARKET","quoteUsd":12,"side":"BUY","symbol":"BNBUSDT","type":"order"},"ruleIds":["order.needs_approval"],"summary":"Proposal passed the rulebook and is waiting for the owner"},"sessionId":"ol-946b4f24ba664935bcc704906b98653c","prevHash":"ab0a9a807c324935cb86dd3eeb7096e692d01422b8516effa975ed64af3975ed","hash":"bb2db8ed92a120d680a7328039af06c1bf5be5145950fa907753ea19332ac238"},{"seq":7,"ts":"2026-09-06T11:56:38.240Z","kind":"approval","actor":"owner","payload":{"action":{"orderType":"MARKET","quoteUsd":12,"side":"BUY","symbol":"BNBUSDT","type":"order"},"summary":"Owner approved BUY BNBUSDT"},"sessionId":"ol-946b4f24ba664935bcc704906b98653c","prevHash":"bb2db8ed92a120d680a7328039af06c1bf5be5145950fa907753ea19332ac238","hash":"2751248fe1e9d940b1d3128bf8946ae53cd4a8973a811b1a081066483669c02e"},{"seq":8,"ts":"2026-09-06T11:56:38.240Z","kind":"order.sent","actor":"agent","payload":{"action":{"orderType":"MARKET","quoteUsd":12,"side":"BUY","symbol":"BNBUSDT","type":"order"},"dryRun":true,"summary":"Dry run: BUY BNBUSDT for 12 USD was not sent to Binance"},"orderId":"ol-946b4f24ba664935bcc704906b98653c","sessionId":"ol-946b4f24ba664935bcc704906b98653c","prevHash":"2751248fe1e9d940b1d3128bf8946ae53cd4a8973a811b1a081066483669c02e","hash":"c0a402669412fbbbf1baa0ee44e2ecf097e87eda244f0e796d4efced21246c82"}],"nextAfterSeq":null}
```

## Step 4

What we tried:

```
A second pending session, and both approvals started in the same tick, which is what
two clicks or a client retry look like when the account read in the middle of the
approval is a real network call:

await Promise.all([runner.approve("ol-bcad18af24cc443f96c18dbbe87c7fbe"), runner.approve("ol-bcad18af24cc443f96c18dbbe87c7fbe")])
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
