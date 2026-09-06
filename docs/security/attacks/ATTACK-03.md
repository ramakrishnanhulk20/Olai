# ATTACK-03: approving the same session twice, in parallel

Captured on 2026-09-06T12:12:35.109Z by `npm run attacks -w @olai/agent`. Everything below is
the output of that run, pasted as it came back.

What this attack does NOT prove: that a restart between the two approvals is safe. The guard lives in memory, which the threat model records as gap 6.2. Nor does it prove anything about the live venue: this run stops at the dry-run branch, so an order.sent line is the closest thing to an order there is here.

Expected outcome, from docs/security/threat-model.md section 5: one order.sent line in the ledger, and the second call returning the record that already executed rather than sending again.

## Step 1

What we tried:

```
POST http://127.0.0.1:55052/api/ask
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

{"id":"ol-920b2cd2f9374d46bd6d9aaf4212048c","question":"Should I add a little BNB?","createdAt":"2026-09-06T12:12:35.698Z","status":"pending","proposal":{"summary":"Add 12 dollars of BNB.","reasoning":"Small size, deep book.","action":{"type":"order","symbol":"BNBUSDT","side":"BUY","quoteUsd":12,"orderType":"MARKET"},"confidence":0.6,"dataUsed":[],"risks":["A weekend gap would hurt this."]},"verdict":{"allowed":true,"requiresApproval":true,"effectiveMaxOrderUsd":20,"reasons":["This order is above $0.00, so the owner has to approve it."],"ruleIds":["order.needs_approval"]}}
```

## Step 2

What we tried:

```
Two approvals of the same session, fired together with Promise.all, each on its own
connection so the server really has both in flight at once:

POST http://127.0.0.1:55052/api/sessions/ol-920b2cd2f9374d46bd6d9aaf4212048c/approve
authorization: Bearer ol.attack-run-token-not-for-production-1

POST http://127.0.0.1:55052/api/sessions/ol-920b2cd2f9374d46bd6d9aaf4212048c/approve
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

{"id":"ol-920b2cd2f9374d46bd6d9aaf4212048c","question":"Should I add a little BNB?","createdAt":"2026-09-06T12:12:35.698Z","status":"executed","proposal":{"summary":"Add 12 dollars of BNB.","reasoning":"Small size, deep book.","action":{"type":"order","symbol":"BNBUSDT","side":"BUY","quoteUsd":12,"orderType":"MARKET"},"confidence":0.6,"dataUsed":[],"risks":["A weekend gap would hurt this."]},"verdict":{"allowed":true,"requiresApproval":true,"effectiveMaxOrderUsd":20,"reasons":["This order is above $0.00, so the owner has to approve it."],"ruleIds":["order.needs_approval"]}}

Second answer:
HTTP 200
connection: close
content-length: 580
content-type: application/json
vary: Origin

{"id":"ol-920b2cd2f9374d46bd6d9aaf4212048c","question":"Should I add a little BNB?","createdAt":"2026-09-06T12:12:35.698Z","status":"executed","proposal":{"summary":"Add 12 dollars of BNB.","reasoning":"Small size, deep book.","action":{"type":"order","symbol":"BNBUSDT","side":"BUY","quoteUsd":12,"orderType":"MARKET"},"confidence":0.6,"dataUsed":[],"risks":["A weekend gap would hurt this."]},"verdict":{"allowed":true,"requiresApproval":true,"effectiveMaxOrderUsd":20,"reasons":["This order is above $0.00, so the owner has to approve it."],"ruleIds":["order.needs_approval"]}}
```

## Step 3

What we tried:

```
GET http://127.0.0.1:55052/api/ledger?sessionId=ol-920b2cd2f9374d46bd6d9aaf4212048c
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

{"entries":[{"seq":3,"ts":"2026-09-06T12:12:35.698Z","kind":"question","actor":"owner","payload":{"question":"Should I add a little BNB?"},"sessionId":"ol-920b2cd2f9374d46bd6d9aaf4212048c","prevHash":"3d47defa6ae25cbb233befad5d0151295044401e85547f91f2f992b2d351cf68","hash":"b7541a5865d02900a5f32a243499b3262fa75d238a48a0b67e75cb8d13d15e89"},{"seq":5,"ts":"2026-09-06T12:12:35.700Z","kind":"proposal","actor":"agent","payload":{"action":{"orderType":"MARKET","quoteUsd":12,"side":"BUY","symbol":"BNBUSDT","type":"order"},"confidence":0.6,"dataUsed":[],"reasoning":"Small size, deep book.","risks":["A weekend gap would hurt this."],"summary":"Add 12 dollars of BNB."},"sessionId":"ol-920b2cd2f9374d46bd6d9aaf4212048c","prevHash":"55a04551b05df9f02099e9b42d97988b286c4035d0b239dcf2229a590ce77fe7","hash":"d5bd6d08de5f7f938ffb1cec69d4f0d7681a9a026760b45d7b6c882605cdfdaf"},{"seq":6,"ts":"2026-09-06T12:12:35.701Z","kind":"proposal","actor":"agent","payload":{"action":{"orderType":"MARKET","quoteUsd":12,"side":"BUY","symbol":"BNBUSDT","type":"order"},"ruleIds":["order.needs_approval"],"summary":"Proposal passed the rulebook and is waiting for the owner"},"sessionId":"ol-920b2cd2f9374d46bd6d9aaf4212048c","prevHash":"d5bd6d08de5f7f938ffb1cec69d4f0d7681a9a026760b45d7b6c882605cdfdaf","hash":"05587ee51f41c7d6c600db84afa24b94f1e7687ded91495ce3f06b3cc76560bf"},{"seq":7,"ts":"2026-09-06T12:12:35.709Z","kind":"approval","actor":"owner","payload":{"action":{"orderType":"MARKET","quoteUsd":12,"side":"BUY","symbol":"BNBUSDT","type":"order"},"summary":"Owner approved BUY BNBUSDT"},"sessionId":"ol-920b2cd2f9374d46bd6d9aaf4212048c","prevHash":"05587ee51f41c7d6c600db84afa24b94f1e7687ded91495ce3f06b3cc76560bf","hash":"979d21c976b8fcc2d87daf1dbe8c2f715c5b4c63968b06ddee88a7b94603c1d0"},{"seq":8,"ts":"2026-09-06T12:12:35.710Z","kind":"order.sent","actor":"agent","payload":{"action":{"orderType":"MARKET","quoteUsd":12,"side":"BUY","symbol":"BNBUSDT","type":"order"},"dryRun":true,"summary":"Dry run: BUY BNBUSDT for 12 USD was not sent to Binance"},"orderId":"ol-920b2cd2f9374d46bd6d9aaf4212048c","sessionId":"ol-920b2cd2f9374d46bd6d9aaf4212048c","prevHash":"979d21c976b8fcc2d87daf1dbe8c2f715c5b4c63968b06ddee88a7b94603c1d0","hash":"3da9c1002796c853a824bb087727530719276af44abba4f4e829337b227da27f"}],"nextAfterSeq":null}
```

## Step 4

What we tried:

```
A second pending session, and both approvals started in the same tick, which is what
two clicks or a client retry look like when the account read in the middle of the
approval is a real network call:

await Promise.all([runner.approve("ol-ec69ac721c5745c796fb14c64ae36224"), runner.approve("ol-ec69ac721c5745c796fb14c64ae36224")])
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
