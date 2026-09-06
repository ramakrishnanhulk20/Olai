# ATTACK-04: replaying an x402 payment: the same paymentId signed twice

Captured on 2026-09-06T11:58:03.822Z by `npm run attacks -w @olai/agent`. Everything below is
the output of that run, pasted as it came back.

What this attack does NOT prove: anything about the real wallet or a real settlement. The wallet here is a stand-in, so this is about Olai refusing to ask twice, not about what Binance would do if it were asked twice.

Expected outcome, from docs/security/threat-model.md section 5: the second call refused without touching the wallet, and one payment.signed line in the ledger. The ledger guard is what catches the third case, where the process has forgotten but the ledger has not.

## Step 1

What we tried:

```
buy({
  "url": "https://api.merchant.invalid/v1/address/current-balance",
  "method": "GET"
}, { dryRun: false, maxUsdPerCall: 0.05, alreadySigned, markSigned })

The merchant answers 402 with:
{
  "x402Version": 2,
  "error": "Payment required",
  "accepts": [
    {
      "scheme": "exact",
      "network": "eip155:56",
      "asset": "0x55d398326f99059fF775485246999027B3197955",
      "amount": "10000000000000000",
      "payTo": "0x93053f1e7A5eFEDa532Fe69CbbE43cBEc3A0F13f",
      "maxTimeoutSeconds": 300
    }
  ]
}
and the wallet previews it as paymentId "attack-04-payment-id".
```

What came back:

```
{
  "status": "paid",
  "data": {
    "ok": true,
    "data": "the paid answer"
  },
  "costUsd": 0.01,
  "txHash": null,
  "paymentId": "attack-04-payment-id",
  "option": {
    "index": 1,
    "status": "READY_TO_SIGN",
    "reasons": [],
    "scheme": "exact",
    "assetTransferMethod": "permit2-exact",
    "binanceChainId": "56",
    "tokenSymbol": "USDT",
    "amount": "0.01",
    "amountUsd": "0.01",
    "payTo": "0x93053f1e7A5eFEDa532Fe69CbbE43cBEc3A0F13f"
  },
  "settlement": null
}

Wallet sign calls so far: 1
```

## Step 2

What we tried:

```
The same call again, same merchant, same paymentId:
buy({
  "url": "https://api.merchant.invalid/v1/address/current-balance",
  "method": "GET"
}, { dryRun: false, maxUsdPerCall: 0.05, alreadySigned, markSigned })
```

What came back:

```
{
  "status": "failed",
  "reason": "this payment was already signed once, Olai will not sign it again",
  "paymentId": "attack-04-payment-id"
}

Wallet sign calls so far: 1
```

## Step 3

What we tried:

```
A claim written to the ledger for a payment id this process has never signed,
which is what a crash between the claim and the merchant answer leaves behind:
  markSigned("attack-04-payment-id-from-a-previous-process", { url, costUsd: 0.01 })
then the same call again, with the wallet previewing that id:
buy({
  "url": "https://api.merchant.invalid/v1/address/current-balance",
  "method": "GET"
}, { dryRun: false, maxUsdPerCall: 0.05, alreadySigned, markSigned })
```

What came back:

```
{
  "status": "failed",
  "reason": "this payment was already signed once, Olai will not sign it again",
  "paymentId": "attack-04-payment-id-from-a-previous-process"
}

Wallet sign calls so far: 1
```

## Step 4

What we tried:

```
GET http://127.0.0.1:55053/api/ledger?kinds=payment.signed
authorization: Bearer ol.attack-run-token-not-for-production-1
```

What came back:

```
HTTP 200
connection: keep-alive
content-length: 995
content-type: application/json
keep-alive: timeout=5
vary: Origin

{"entries":[{"seq":2,"ts":"2026-09-06T11:58:04.298Z","kind":"payment.signed","actor":"agent","payload":{"paymentId":"attack-04-payment-id","summary":"About to sign one payment of $0.0100 for https://api.merchant.invalid/v1/address/current-balance","url":"https://api.merchant.invalid/v1/address/current-balance"},"costUsd":0.01,"prevHash":"ad8e9ef449e278697f7d5ff9cbe77718dd813cde5739686f07a03c41738384c8","hash":"4c8b5b8a27d9ee4ab039931eb9c662e5466eebd0a47c8e71d0c93b58171d31f3"},{"seq":3,"ts":"2026-09-06T11:58:04.299Z","kind":"payment.signed","actor":"agent","payload":{"paymentId":"attack-04-payment-id-from-a-previous-process","summary":"About to sign one payment of $0.0100 for https://api.merchant.invalid/v1/address/current-balance","url":"https://api.merchant.invalid/v1/address/current-balance"},"costUsd":0.01,"prevHash":"4c8b5b8a27d9ee4ab039931eb9c662e5466eebd0a47c8e71d0c93b58171d31f3","hash":"16afe7fdef1c919574f8d5c8e6c7eb5203fafc9d69282adf8356fddcf44bff3b"}],"nextAfterSeq":null}
```

RESULT: BLOCKED
