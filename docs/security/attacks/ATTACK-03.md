# ATTACK-03: approving the same session twice, in parallel

Captured on 2026-09-07T12:14:01.325Z by `npm run attacks -w @olai/agent`. Everything below is
the output of that run, pasted as it came back.

What this attack does NOT prove: that a restart between the two approvals is safe. The guard lives in memory, which the threat model records as gap 6.2. Nor does it prove anything about the live venue: this run stops at the dry-run branch, so an order.sent line is the closest thing to an order there is here.

Expected outcome, from docs/security/threat-model.md section 5: one order.sent line in the ledger, and the second call returning the record that already executed rather than sending again.

## Step 1

What we tried:

```
POST http://127.0.0.1:54476/api/ask
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

{"id":"ol-bc0362aeebb64ebf8a6da79738171732","question":"Should I add a little BNB?","createdAt":"2026-09-07T12:14:01.758Z","status":"pending","proposal":{"summary":"Add 12 dollars of BNB.","reasoning":"Small size, deep book.","action":{"type":"order","symbol":"BNBUSDT","side":"BUY","quoteUsd":12,"orderType":"MARKET"},"confidence":0.6,"dataUsed":[],"risks":["A weekend gap would hurt this."]},"verdict":{"allowed":true,"requiresApproval":true,"effectiveMaxOrderUsd":20,"reasons":["This order is above $0.00, so the owner has to approve it."],"ruleIds":["order.needs_approval"]}}
```

## Step 2

What we tried:

```
Two approvals of the same session, fired together with Promise.all, each on its own
connection so the server really has both in flight at once:

POST http://127.0.0.1:54476/api/sessions/ol-bc0362aeebb64ebf8a6da79738171732/approve
authorization: Bearer ol.attack-run-token-not-for-production-1

POST http://127.0.0.1:54476/api/sessions/ol-bc0362aeebb64ebf8a6da79738171732/approve
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

{"id":"ol-bc0362aeebb64ebf8a6da79738171732","question":"Should I add a little BNB?","createdAt":"2026-09-07T12:14:01.758Z","status":"executed","proposal":{"summary":"Add 12 dollars of BNB.","reasoning":"Small size, deep book.","action":{"type":"order","symbol":"BNBUSDT","side":"BUY","quoteUsd":12,"orderType":"MARKET"},"confidence":0.6,"dataUsed":[],"risks":["A weekend gap would hurt this."]},"verdict":{"allowed":true,"requiresApproval":true,"effectiveMaxOrderUsd":20,"reasons":["This order is above $0.00, so the owner has to approve it."],"ruleIds":["order.needs_approval"]}}

Second answer:
HTTP 200
connection: close
content-length: 580
content-type: application/json
vary: Origin

{"id":"ol-bc0362aeebb64ebf8a6da79738171732","question":"Should I add a little BNB?","createdAt":"2026-09-07T12:14:01.758Z","status":"executed","proposal":{"summary":"Add 12 dollars of BNB.","reasoning":"Small size, deep book.","action":{"type":"order","symbol":"BNBUSDT","side":"BUY","quoteUsd":12,"orderType":"MARKET"},"confidence":0.6,"dataUsed":[],"risks":["A weekend gap would hurt this."]},"verdict":{"allowed":true,"requiresApproval":true,"effectiveMaxOrderUsd":20,"reasons":["This order is above $0.00, so the owner has to approve it."],"ruleIds":["order.needs_approval"]}}
```

## Step 3

What we tried:

```
GET http://127.0.0.1:54476/api/ledger?sessionId=ol-bc0362aeebb64ebf8a6da79738171732
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

{"entries":[{"seq":3,"ts":"2026-09-07T12:14:01.759Z","kind":"question","actor":"owner","payload":{"question":"Should I add a little BNB?"},"sessionId":"ol-bc0362aeebb64ebf8a6da79738171732","prevHash":"65c5e5b3656d4ad58b9fd990a8ef2cbe39bca62789e1a0955c7ff2c3c6515a5e","hash":"76aad48667311a06713f1b42e8a6d98d11a6ac49f8707a7ca9b290c95541914e"},{"seq":5,"ts":"2026-09-07T12:14:01.761Z","kind":"proposal","actor":"agent","payload":{"action":{"orderType":"MARKET","quoteUsd":12,"side":"BUY","symbol":"BNBUSDT","type":"order"},"confidence":0.6,"dataUsed":[],"reasoning":"Small size, deep book.","risks":["A weekend gap would hurt this."],"summary":"Add 12 dollars of BNB."},"sessionId":"ol-bc0362aeebb64ebf8a6da79738171732","prevHash":"0f0fcc7475f24e34cd302938433811eabbd6bff412b79dc964083e3cc7e16d91","hash":"0e70c10a1fc3aa8c4e8383a70cff3352f650317d98ce1dd730f3c321b4e6f2ed"},{"seq":6,"ts":"2026-09-07T12:14:01.762Z","kind":"proposal","actor":"agent","payload":{"action":{"orderType":"MARKET","quoteUsd":12,"side":"BUY","symbol":"BNBUSDT","type":"order"},"ruleIds":["order.needs_approval"],"summary":"Proposal passed the rulebook and is waiting for the owner"},"sessionId":"ol-bc0362aeebb64ebf8a6da79738171732","prevHash":"0e70c10a1fc3aa8c4e8383a70cff3352f650317d98ce1dd730f3c321b4e6f2ed","hash":"e3c071ac064b0d2236e3efd79f5583e020be1070f9bafb88c9e6da2d5645fafc"},{"seq":7,"ts":"2026-09-07T12:14:01.766Z","kind":"approval","actor":"owner","payload":{"action":{"orderType":"MARKET","quoteUsd":12,"side":"BUY","symbol":"BNBUSDT","type":"order"},"summary":"Owner approved BUY BNBUSDT"},"sessionId":"ol-bc0362aeebb64ebf8a6da79738171732","prevHash":"e3c071ac064b0d2236e3efd79f5583e020be1070f9bafb88c9e6da2d5645fafc","hash":"aa8e60f14e8968202227f38463f5b17d141b0f8ffee9f3cb8f384791f67459ef"},{"seq":8,"ts":"2026-09-07T12:14:01.767Z","kind":"order.sent","actor":"agent","payload":{"action":{"orderType":"MARKET","quoteUsd":12,"side":"BUY","symbol":"BNBUSDT","type":"order"},"dryRun":true,"summary":"Dry run: BUY BNBUSDT for 12 USD was not sent to Binance"},"orderId":"ol-bc0362aeebb64ebf8a6da79738171732","sessionId":"ol-bc0362aeebb64ebf8a6da79738171732","prevHash":"aa8e60f14e8968202227f38463f5b17d141b0f8ffee9f3cb8f384791f67459ef","hash":"c8475f2bffc8183b82ac94b38c06425be66db9bdbfe6dc6b9bad09adec67ef92"}],"nextAfterSeq":null}
```

## Step 4

What we tried:

```
A second pending session, and both approvals started in the same tick, which is what
two clicks or a client retry look like when the account read in the middle of the
approval is a real network call:

await Promise.all([runner.approve("ol-7629fc8408154ed2adb129bce86eafb4"), runner.approve("ol-7629fc8408154ed2adb129bce86eafb4")])
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
