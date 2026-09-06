# ATTACK-03: approving the same session twice, in parallel

Captured on 2026-09-06T11:15:01.925Z by `npm run attacks -w @olai/agent`. Everything below is
the output of that run, pasted as it came back.

What this attack does NOT prove: that a restart between the two approvals is safe. The guard lives in memory, which the threat model records as gap 6.2. Nor does it prove anything about the live venue: this run stops at the dry-run branch, so an order.sent line is the closest thing to an order there is here.

Expected outcome, from docs/security/threat-model.md section 5: one order.sent line in the ledger, and the second call returning the record that already executed rather than sending again.

## Step 1

What we tried:

```
POST http://127.0.0.1:61204/api/ask
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

{"id":"ol-b586a8b79dde4ee5b900f0143b1d72bc","question":"Should I add a little BNB?","createdAt":"2026-09-06T11:15:02.438Z","status":"pending","proposal":{"summary":"Add 12 dollars of BNB.","reasoning":"Small size, deep book.","action":{"type":"order","symbol":"BNBUSDT","side":"BUY","quoteUsd":12,"orderType":"MARKET"},"confidence":0.6,"dataUsed":[],"risks":["A weekend gap would hurt this."]},"verdict":{"allowed":true,"requiresApproval":true,"effectiveMaxOrderUsd":20,"reasons":["This order is above $0.00, so the owner has to approve it."],"ruleIds":["order.needs_approval"]}}
```

## Step 2

What we tried:

```
Two approvals of the same session, fired together with Promise.all, each on its own
connection so the server really has both in flight at once:

POST http://127.0.0.1:61204/api/sessions/ol-b586a8b79dde4ee5b900f0143b1d72bc/approve
authorization: Bearer ol.attack-run-token-not-for-production-1

POST http://127.0.0.1:61204/api/sessions/ol-b586a8b79dde4ee5b900f0143b1d72bc/approve
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

{"id":"ol-b586a8b79dde4ee5b900f0143b1d72bc","question":"Should I add a little BNB?","createdAt":"2026-09-06T11:15:02.438Z","status":"executed","proposal":{"summary":"Add 12 dollars of BNB.","reasoning":"Small size, deep book.","action":{"type":"order","symbol":"BNBUSDT","side":"BUY","quoteUsd":12,"orderType":"MARKET"},"confidence":0.6,"dataUsed":[],"risks":["A weekend gap would hurt this."]},"verdict":{"allowed":true,"requiresApproval":true,"effectiveMaxOrderUsd":20,"reasons":["This order is above $0.00, so the owner has to approve it."],"ruleIds":["order.needs_approval"]}}

Second answer:
HTTP 200
connection: close
content-length: 580
content-type: application/json
vary: Origin

{"id":"ol-b586a8b79dde4ee5b900f0143b1d72bc","question":"Should I add a little BNB?","createdAt":"2026-09-06T11:15:02.438Z","status":"executed","proposal":{"summary":"Add 12 dollars of BNB.","reasoning":"Small size, deep book.","action":{"type":"order","symbol":"BNBUSDT","side":"BUY","quoteUsd":12,"orderType":"MARKET"},"confidence":0.6,"dataUsed":[],"risks":["A weekend gap would hurt this."]},"verdict":{"allowed":true,"requiresApproval":true,"effectiveMaxOrderUsd":20,"reasons":["This order is above $0.00, so the owner has to approve it."],"ruleIds":["order.needs_approval"]}}
```

## Step 3

What we tried:

```
GET http://127.0.0.1:61204/api/ledger?sessionId=ol-b586a8b79dde4ee5b900f0143b1d72bc
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

{"entries":[{"seq":3,"ts":"2026-09-06T11:15:02.438Z","kind":"question","actor":"owner","payload":{"question":"Should I add a little BNB?"},"sessionId":"ol-b586a8b79dde4ee5b900f0143b1d72bc","prevHash":"27315af27257dabeae794c2aa74bebd5cbb42a9726b32dac0a152eac5534627d","hash":"c9574b2126f4bb29cb7af6b523a11b0abe84cc6db7a3dfa66c325f9c58bbcb85"},{"seq":5,"ts":"2026-09-06T11:15:02.440Z","kind":"proposal","actor":"agent","payload":{"action":{"orderType":"MARKET","quoteUsd":12,"side":"BUY","symbol":"BNBUSDT","type":"order"},"confidence":0.6,"dataUsed":[],"reasoning":"Small size, deep book.","risks":["A weekend gap would hurt this."],"summary":"Add 12 dollars of BNB."},"sessionId":"ol-b586a8b79dde4ee5b900f0143b1d72bc","prevHash":"27cc794416f234fc9b89eb0f0279987a49b2bd5982d884874b00fb6826c7e963","hash":"ebd4039b3766b6caee074ca59e2a5c6dd6986ceba17b6bdf92a757a4aea0b740"},{"seq":6,"ts":"2026-09-06T11:15:02.441Z","kind":"proposal","actor":"agent","payload":{"action":{"orderType":"MARKET","quoteUsd":12,"side":"BUY","symbol":"BNBUSDT","type":"order"},"ruleIds":["order.needs_approval"],"summary":"Proposal passed the rulebook and is waiting for the owner"},"sessionId":"ol-b586a8b79dde4ee5b900f0143b1d72bc","prevHash":"ebd4039b3766b6caee074ca59e2a5c6dd6986ceba17b6bdf92a757a4aea0b740","hash":"ab8481403c6ac215f9953dc744b0a3168b4751ac574ca12b4cbb0f6a4bed8c64"},{"seq":7,"ts":"2026-09-06T11:15:02.448Z","kind":"approval","actor":"owner","payload":{"action":{"orderType":"MARKET","quoteUsd":12,"side":"BUY","symbol":"BNBUSDT","type":"order"},"summary":"Owner approved BUY BNBUSDT"},"sessionId":"ol-b586a8b79dde4ee5b900f0143b1d72bc","prevHash":"ab8481403c6ac215f9953dc744b0a3168b4751ac574ca12b4cbb0f6a4bed8c64","hash":"ce2ecec52b996a206da50e2cffe5041b98464ff499df0d935d7917b27788b1ee"},{"seq":8,"ts":"2026-09-06T11:15:02.448Z","kind":"order.sent","actor":"agent","payload":{"action":{"orderType":"MARKET","quoteUsd":12,"side":"BUY","symbol":"BNBUSDT","type":"order"},"dryRun":true,"summary":"Dry run: BUY BNBUSDT for 12 USD was not sent to Binance"},"orderId":"ol-b586a8b79dde4ee5b900f0143b1d72bc","sessionId":"ol-b586a8b79dde4ee5b900f0143b1d72bc","prevHash":"ce2ecec52b996a206da50e2cffe5041b98464ff499df0d935d7917b27788b1ee","hash":"64350838d23e25b453ae722ef74e0b6eed797b20dff858d04c5f404bedaf77fa"}],"nextAfterSeq":null}
```

## Step 4

What we tried:

```
A second pending session, and both approvals started in the same tick, which is what
two clicks or a client retry look like when the account read in the middle of the
approval is a real network call:

await Promise.all([runner.approve("ol-19eb9d9a40d5462581f5ef8f24b0b935"), runner.approve("ol-19eb9d9a40d5462581f5ef8f24b0b935")])
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
