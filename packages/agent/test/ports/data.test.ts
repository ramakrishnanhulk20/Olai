import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { BazaarClient } from '../../src/bazaar/client.js';
import { Ledger } from '../../src/ledger/ledger.js';
import { bazaarDataPort, memorySignatureGuard, withPaymentLock } from '../../src/ports/data.js';
import { Baw, type BawRunner } from '../../src/x402/baw.js';

/**
 * What this file does NOT cover: the live Bazaar and the real wallet, which
 * scripts/probe-bazaar.ts exercises, the ledger guard, which is proved against a
 * real ledger in test/x402/buyer.test.ts, and search, which is the Bazaar
 * client's own test. The wallet here is a scripted BawRunner, so it proves what
 * the port writes down, never that a real signature settles on chain.
 */

const nansen402 = JSON.parse(
  readFileSync(new URL('../fixtures/nansen-402.json', import.meta.url), 'utf8'),
) as Record<string, unknown>;

const MERCHANT_URL = 'https://api.nansen.ai/api/v1/profiler/address/current-balance';
const SETTLEMENT_HASH = '0x1f7b3c9a2e5d4806b1c7a09f3e6d5c48b2a91e0f7d3c6b5a4938271605f4e3d2';

function base64(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
}

function scriptedFetch(steps: Response[]): typeof fetch {
  return (async () => {
    const next = steps.shift();
    if (!next) {
      throw new Error('the test ran out of queued responses');
    }
    return next;
  }) as unknown as typeof fetch;
}

function paidMerchant(): typeof fetch {
  return scriptedFetch([
    new Response(JSON.stringify(nansen402), {
      status: 402,
      headers: { 'content-type': 'application/json', 'payment-required': base64(nansen402) },
    }),
    new Response(JSON.stringify({ data: [{ token_symbol: 'BNB' }] }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'payment-response': base64({ success: true, txHash: SETTLEMENT_HASH }),
      },
    }),
  ]);
}

function scriptedWallet(paymentId: string): Baw {
  const run: BawRunner = async (args) => {
    if (args[1] === 'preview') {
      return {
        stdout: JSON.stringify({
          success: true,
          data: {
            paymentId,
            options: [
              {
                index: 1,
                status: 'READY_TO_SIGN',
                reasons: [],
                scheme: 'exact',
                assetTransferMethod: 'eip3009',
                binanceChainId: '56',
                tokenSymbol: 'U',
                amount: '0.01',
                amountUsd: '0.01',
                payTo: '0x93053f1e7A5eFEDa532Fe69CbbE43cBEc3A0F13f',
                needApproveFirst: false,
              },
            ],
          },
        }),
        exitCode: 0,
      };
    }
    if (args[1] === 'sign') {
      return {
        stdout: JSON.stringify({
          success: true,
          data: {
            paymentHeaderName: 'PAYMENT-SIGNATURE',
            paymentHeaderValue: 'eyJ4NDAyVmVyc2lvbiI6Mi4uLg==',
            approveTxHash: null,
            binanceChainId: null,
            signatureExpiresAt: 1788644000,
          },
        }),
        exitCode: 0,
      };
    }
    throw new Error(`unexpected baw call: ${args.join(' ')}`);
  };

  return new Baw({ run });
}

const openLedgers: Ledger[] = [];

afterEach(() => {
  while (openLedgers.length > 0) {
    openLedgers.pop()?.close();
  }
});

function openLedger(): Ledger {
  const ledger = new Ledger(':memory:');
  openLedgers.push(ledger);
  return ledger;
}

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('withPaymentLock', () => {
  it('runs two buys one after the other instead of side by side', async () => {
    const marks: string[] = [];

    const buy = (name: string) =>
      withPaymentLock(async () => {
        marks.push(`${name} start`);
        await tick();
        marks.push(`${name} end`);
        return name;
      });

    const done = await Promise.all([buy('first'), buy('second')]);

    expect(done).toEqual(['first', 'second']);
    expect(marks).toEqual(['first start', 'first end', 'second start', 'second end']);
  });

  it('keeps the queue moving after one buy throws', async () => {
    const failing = withPaymentLock(async () => {
      throw new Error('the merchant hung up');
    });

    await expect(failing).rejects.toThrowError('the merchant hung up');
    await expect(withPaymentLock(async () => 'next in line')).resolves.toBe('next in line');
  });
});

describe('memorySignatureGuard', () => {
  it('lets a payment id through once and never again', () => {
    const guard = memorySignatureGuard();

    expect(guard.alreadySigned('pay-1')).toBe(false);
    guard.markSigned('pay-1', { url: 'https://api.nansen.ai/x402', costUsd: 0.01 });

    expect(guard.alreadySigned('pay-1')).toBe(true);
    expect(guard.alreadySigned('pay-2')).toBe(false);
  });

  it('forgets nothing within a process and shares nothing between guards', () => {
    const one = memorySignatureGuard();
    const two = memorySignatureGuard();

    one.markSigned('pay-3', { url: 'https://api.nansen.ai/x402', costUsd: 0.01 });

    expect(one.alreadySigned('pay-3')).toBe(true);
    expect(two.alreadySigned('pay-3')).toBe(false);
  });
});

describe('bazaarDataPort.buy', () => {
  function port(ledger: Ledger, opts: { dryRun: boolean; paymentId: string }) {
    return bazaarDataPort({
      bazaar: new BazaarClient({ baseUrl: 'https://bazaar.invalid', fetch: scriptedFetch([]) }),
      baw: scriptedWallet(opts.paymentId),
      ledger,
      dryRun: opts.dryRun,
      fetch: paidMerchant(),
    });
  }

  it('records one payment.settled with the settlement hash after the signature it claimed', async () => {
    const ledger = openLedger();

    const outcome = await port(ledger, { dryRun: false, paymentId: 'pay-settled-1' }).buy(
      { url: MERCHANT_URL, method: 'POST', body: { chain: 'bnb' } },
      0.05,
    );

    expect(outcome.status).toBe('paid');

    const settled = ledger.list({ kinds: ['payment.settled'] });
    expect(settled).toHaveLength(1);
    expect(settled[0]?.actor).toBe('merchant');
    expect(settled[0]?.txHash).toBe(SETTLEMENT_HASH);
    expect(settled[0]?.costUsd).toBe(0.01);
    expect(settled[0]?.payload['paymentId']).toBe('pay-settled-1');
    expect(settled[0]?.payload['url']).toBe(MERCHANT_URL);
    expect(settled[0]?.payload['settlement']).toEqual({ success: true, txHash: SETTLEMENT_HASH });

    const signed = ledger.list({ kinds: ['payment.signed'] });
    expect(signed).toHaveLength(1);
    expect(signed[0]?.seq).toBeLessThan(settled[0]?.seq ?? 0);
  });

  it('writes no settlement line when the run is a dry one and nothing was signed', async () => {
    const ledger = openLedger();

    const outcome = await port(ledger, { dryRun: true, paymentId: 'pay-dry-1' }).buy(
      { url: MERCHANT_URL, method: 'POST', body: { chain: 'bnb' } },
      0.05,
    );

    expect(outcome.status).toBe('dry-run');
    expect(ledger.list({ kinds: ['payment.settled', 'payment.signed'] })).toHaveLength(0);
  });
});
