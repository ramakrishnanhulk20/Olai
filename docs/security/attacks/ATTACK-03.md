# ATTACK-03: approving the same session twice, in parallel

Captured on 2026-09-06T11:58:03.822Z by `npm run attacks -w @olai/agent`. Everything below is
the output of that run, pasted as it came back.

What this attack does NOT prove: that a restart between the two approvals is safe. The guard lives in memory, which the threat model records as gap 6.2. Nor does it prove anything about the live venue: this run stops at the dry-run branch, so an order.sent line is the closest thing to an order there is here.

Expected outcome, from docs/security/threat-model.md section 5: one order.sent line in the ledger, and the second call returning the record that already executed rather than sending again.

## Step 1

What we tried:

```
POST http://127.0.0.1:55048/api/ask
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

{"id":"ol-3cce76b492df41d7b125844aa1dc7ca2","question":"Should I add a little BNB?","createdAt":"2026-09-06T11:58:04.265Z","status":"pending","proposal":{"summary":"Add 12 dollars of BNB.","reasoning":"Small size, deep book.","action":{"type":"order","symbol":"BNBUSDT","side":"BUY","quoteUsd":12,"orderType":"MARKET"},"confidence":0.6,"dataUsed":[],"risks":["A weekend gap would hurt this."]},"verdict":{"allowed":true,"requiresApproval":true,"effectiveMaxOrderUsd":20,"reasons":["This order is above $0.00, so the owner has to approve it."],"ruleIds":["order.needs_approval"]}}
```

## Step 2

What we tried:

```
Two approvals of the same session, fired together with Promise.all, each on its own
connection so the server really has both in flight at once:

POST http://127.0.0.1:55048/api/sessions/ol-3cce76b492df41d7b125844aa1dc7ca2/approve
authorization: Bearer ol.attack-run-token-not-for-production-1

POST http://127.0.0.1:55048/api/sessions/ol-3cce76b492df41d7b125844aa1dc7ca2/approve
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

{"id":"ol-3cce76b492df41d7b125844aa1dc7ca2","question":"Should I add a little BNB?","createdAt":"2026-09-06T11:58:04.265Z","status":"executed","proposal":{"summary":"Add 12 dollars of BNB.","reasoning":"Small size, deep book.","action":{"type":"order","symbol":"BNBUSDT","side":"BUY","quoteUsd":12,"orderType":"MARKET"},"confidence":0.6,"dataUsed":[],"risks":["A weekend gap would hurt this."]},"verdict":{"allowed":true,"requiresApproval":true,"effectiveMaxOrderUsd":20,"reasons":["This order is above $0.00, so the owner has to approve it."],"ruleIds":["order.needs_approval"]}}

Second answer:
HTTP 200
connection: close
content-length: 580
content-type: application/json
vary: Origin

{"id":"ol-3cce76b492df41d7b125844aa1dc7ca2","question":"Should I add a little BNB?","createdAt":"2026-09-06T11:58:04.265Z","status":"executed","proposal":{"summary":"Add 12 dollars of BNB.","reasoning":"Small size, deep book.","action":{"type":"order","symbol":"BNBUSDT","side":"BUY","quoteUsd":12,"orderType":"MARKET"},"confidence":0.6,"dataUsed":[],"risks":["A weekend gap would hurt this."]},"verdict":{"allowed":true,"requiresApproval":true,"effectiveMaxOrderUsd":20,"reasons":["This order is above $0.00, so the owner has to approve it."],"ruleIds":["order.needs_approval"]}}
```

## Step 3

What we tried:

```
GET http://127.0.0.1:55048/api/ledger?sessionId=ol-3cce76b492df41d7b125844aa1dc7ca2
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

{"entries":[{"seq":3,"ts":"2026-09-06T11:58:04.266Z","kind":"question","actor":"owner","payload":{"question":"Should I add a little BNB?"},"sessionId":"ol-3cce76b492df41d7b125844aa1dc7ca2","prevHash":"ba7c515b3b5d0a8d77323a188b5d866a1980d846755c4f9c8e72dac4800c5e7a","hash":"a0786e87903e9fbb8bf074065604f02b11fe24bf04e5b40c79d0c7544e086a1f"},{"seq":5,"ts":"2026-09-06T11:58:04.268Z","kind":"proposal","actor":"agent","payload":{"action":{"orderType":"MARKET","quoteUsd":12,"side":"BUY","symbol":"BNBUSDT","type":"order"},"confidence":0.6,"dataUsed":[],"reasoning":"Small size, deep book.","risks":["A weekend gap would hurt this."],"summary":"Add 12 dollars of BNB."},"sessionId":"ol-3cce76b492df41d7b125844aa1dc7ca2","prevHash":"fc05d43174e3f6a21144fc695d7cc9a7e4720a2f179ea125ed9bb626f711aab9","hash":"aa019d0d89e323b76270a149cc24f36a19fb41f0ee9cff75fcf544dc981f7b53"},{"seq":6,"ts":"2026-09-06T11:58:04.269Z","kind":"proposal","actor":"agent","payload":{"action":{"orderType":"MARKET","quoteUsd":12,"side":"BUY","symbol":"BNBUSDT","type":"order"},"ruleIds":["order.needs_approval"],"summary":"Proposal passed the rulebook and is waiting for the owner"},"sessionId":"ol-3cce76b492df41d7b125844aa1dc7ca2","prevHash":"aa019d0d89e323b76270a149cc24f36a19fb41f0ee9cff75fcf544dc981f7b53","hash":"32a7613b4a7edb5d77613644b2a6fea84ad1bde3f8568de140a3c5090147d83a"},{"seq":7,"ts":"2026-09-06T11:58:04.275Z","kind":"approval","actor":"owner","payload":{"action":{"orderType":"MARKET","quoteUsd":12,"side":"BUY","symbol":"BNBUSDT","type":"order"},"summary":"Owner approved BUY BNBUSDT"},"sessionId":"ol-3cce76b492df41d7b125844aa1dc7ca2","prevHash":"32a7613b4a7edb5d77613644b2a6fea84ad1bde3f8568de140a3c5090147d83a","hash":"c787716b9819b867528ae654b60ecd468de386ec7b24e331942f11d0a1c90e6c"},{"seq":8,"ts":"2026-09-06T11:58:04.276Z","kind":"order.sent","actor":"agent","payload":{"action":{"orderType":"MARKET","quoteUsd":12,"side":"BUY","symbol":"BNBUSDT","type":"order"},"dryRun":true,"summary":"Dry run: BUY BNBUSDT for 12 USD was not sent to Binance"},"orderId":"ol-3cce76b492df41d7b125844aa1dc7ca2","sessionId":"ol-3cce76b492df41d7b125844aa1dc7ca2","prevHash":"c787716b9819b867528ae654b60ecd468de386ec7b24e331942f11d0a1c90e6c","hash":"8dabf2e5d74a9667ca28931fe3fd7774556f9bfcbca29753f495c97e719e1c2b"}],"nextAfterSeq":null}
```

## Step 4

What we tried:

```
A second pending session, and both approvals started in the same tick, which is what
two clicks or a client retry look like when the account read in the middle of the
approval is a real network call:

await Promise.all([runner.approve("ol-ec9ffb7c0ead4c0cb830d21932ae882e"), runner.approve("ol-ec9ffb7c0ead4c0cb830d21932ae882e")])
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
