/**
 * ATTACK-04: paying the same 402 twice.
 *
 * What this does NOT prove: that the Binance wallet itself refuses a replayed
 * signature. This never reaches the real wallet. It proves Olai's own two
 * guards: the in-memory set of signed payment ids, and the ledger claim written
 * before the wallet is ever asked, which is the one that survives a restart.
 * It also does not cover a merchant that answers with a different paymentId for
 * the same call, which Olai would treat as a new payment.
 */

import { OWNER_HEADERS, call, pretty, startService, step, stubBaw } from './harness.js';
import { ledgerSignatureGuard } from '../src/ports/data.js';
import { buy } from '../src/x402/buyer.js';
import type { Attack, AttackResult, AttackStep } from './report.js';

const MERCHANT_URL = 'https://api.merchant.invalid/v1/address/current-balance';

const PAYMENT_ID = 'attack-04-payment-id';
const RESTART_PAYMENT_ID = 'attack-04-payment-id-from-a-previous-process';

/** Shaped like the live Nansen 402 recorded in this repo, trimmed to the BSC option the wallet signs. */
const PAYMENT_REQUIRED = {
  x402Version: 2,
  error: 'Payment required',
  accepts: [
    {
      scheme: 'exact',
      network: 'eip155:56',
      asset: '0x55d398326f99059fF775485246999027B3197955',
      amount: '10000000000000000',
      payTo: '0x93053f1e7A5eFEDa532Fe69CbbE43cBEc3A0F13f',
      maxTimeoutSeconds: 300,
    },
  ],
};

const PAYMENT_HEADER = 'x-payment';

function hasPaymentHeader(init?: RequestInit): boolean {
  const headers = (init?.headers ?? {}) as Record<string, string>;
  return Object.keys(headers).some((name) => name.toLowerCase() === PAYMENT_HEADER);
}

async function run(): Promise<AttackResult> {
  let signCalls = 0;
  let previewPaymentId = PAYMENT_ID;

  const baw = stubBaw((args) => {
    if (args[0] === 'x402-payment' && args[1] === 'preview') {
      return {
        paymentId: previewPaymentId,
        options: [
          {
            index: 1,
            status: 'READY_TO_SIGN',
            reasons: [],
            scheme: 'exact',
            assetTransferMethod: 'permit2-exact',
            binanceChainId: '56',
            tokenSymbol: 'USDT',
            amount: '0.01',
            amountUsd: '0.01',
            payTo: '0x93053f1e7A5eFEDa532Fe69CbbE43cBEc3A0F13f',
          },
        ],
      };
    }

    if (args[0] === 'x402-payment' && args[1] === 'sign') {
      signCalls += 1;
      return {
        paymentHeaderName: PAYMENT_HEADER,
        paymentHeaderValue: 'attack-04-signature',
        approveTxHash: null,
        binanceChainId: '56',
        signatureExpiresAt: Date.now() + 300_000,
      };
    }

    return { status: 'CONNECTED' };
  });

  const merchant: typeof fetch = (async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    if (hasPaymentHeader(init)) {
      return new Response(JSON.stringify({ ok: true, data: 'the paid answer' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify(PAYMENT_REQUIRED), {
      status: 402,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  const harness = await startService({ name: 'attack-04', baw, fetch: merchant });
  const steps: AttackStep[] = [];

  try {
    const guard = ledgerSignatureGuard(harness.service.ledger);
    const options = {
      baw,
      // The service itself stays in dry run. This one call is made with dryRun
      // false on purpose, because a dry run never reaches the signing guard.
      dryRun: false,
      maxUsdPerCall: 0.05,
      fetch: merchant,
      alreadySigned: guard.alreadySigned,
      markSigned: guard.markSigned,
    };

    const request = { url: MERCHANT_URL, method: 'GET' as const };
    const callText = `buy(${pretty(request)}, { dryRun: false, maxUsdPerCall: 0.05, alreadySigned, markSigned })`;

    const first = await buy(request, options);
    steps.push(step(`${callText}\n\nThe merchant answers 402 with:\n${pretty(PAYMENT_REQUIRED)}\nand the wallet previews it as paymentId "${PAYMENT_ID}".`, `${pretty(first)}\n\nWallet sign calls so far: ${signCalls}`));

    const second = await buy(request, options);
    steps.push(step(`The same call again, same merchant, same paymentId:\n${callText}`, `${pretty(second)}\n\nWallet sign calls so far: ${signCalls}`));

    // A payment id the running process has never seen, but the ledger has,
    // which is what a restart mid-payment looks like from the inside.
    previewPaymentId = RESTART_PAYMENT_ID;
    guard.markSigned(RESTART_PAYMENT_ID, { url: MERCHANT_URL, costUsd: 0.01 });
    const afterRestart = await buy(request, options);
    steps.push(
      step(
        [
          'A claim written to the ledger for a payment id this process has never signed,',
          'which is what a crash between the claim and the merchant answer leaves behind:',
          `  markSigned("${RESTART_PAYMENT_ID}", { url, costUsd: 0.01 })`,
          'then the same call again, with the wallet previewing that id:',
          callText,
        ].join('\n'),
        `${pretty(afterRestart)}\n\nWallet sign calls so far: ${signCalls}`,
      ),
    );

    const ledger = await call(harness.base, '/api/ledger?kinds=payment.signed', { headers: OWNER_HEADERS });
    steps.push(ledger);

    const entries = (ledger.json() as { entries: Array<{ payload: Record<string, unknown> }> }).entries;
    const claimsForFirstId = entries.filter((entry) => entry.payload['paymentId'] === PAYMENT_ID);

    const blocked =
      first.status === 'paid' &&
      second.status === 'failed' &&
      afterRestart.status === 'failed' &&
      signCalls === 1 &&
      claimsForFirstId.length === 1;

    return {
      id: 'ATTACK-04',
      name: 'replaying an x402 payment: the same paymentId signed twice',
      notProved:
        'anything about the real wallet or a real settlement. The wallet here is a stand-in, so this is about Olai refusing to ask twice, not about what Binance would do if it were asked twice.',
      expected:
        'the second call refused without touching the wallet, and one payment.signed line in the ledger. The ledger guard is what catches the third case, where the process has forgotten but the ledger has not.',
      steps,
      blocked,
      ...(blocked
        ? {}
        : {
            finding: `The wallet was asked to sign ${signCalls} times and the ledger holds ${claimsForFirstId.length} claims for ${PAYMENT_ID}. The second call came back ${second.status} and the post-restart call came back ${afterRestart.status}.`,
          }),
    };
  } finally {
    await harness.stop();
  }
}

export const attack: Attack = {
  id: 'ATTACK-04',
  name: 'replaying an x402 payment: the same paymentId signed twice',
  run,
};
