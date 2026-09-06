import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { Ledger } from '../../src/ledger/ledger.js';
import { ledgerSignatureGuard, memorySignatureGuard } from '../../src/ports/data.js';
import { Baw, type BawRunner } from '../../src/x402/baw.js';
import { buy } from '../../src/x402/buyer.js';

// What this file does NOT cover: a real signature and a real settlement, which
// nothing but a funded wallet can prove, and the wallet CLI's own behaviour, which
// is faked here through BawRunner. The 402 is the real one Nansen returned on
// 2026-09-06; the preview and sign payloads copy the shapes in the Binance skill
// docs and the live preview recorded in spikes/wallet/RESULT.md.

const nansen402 = JSON.parse(
  readFileSync(new URL('../fixtures/nansen-402.json', import.meta.url), 'utf8'),
) as Record<string, unknown>;

const URL_UNDER_TEST = 'https://api.nansen.ai/api/v1/profiler/address/current-balance';

function base64(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
}

function paymentRequiredResponse(payload: unknown = nansen402): Response {
  return new Response(JSON.stringify(payload), {
    status: 402,
    headers: { 'content-type': 'application/json', 'payment-required': base64(payload) },
  });
}

function paidResponse(settlement: unknown): Response {
  return new Response(JSON.stringify({ data: [{ token_symbol: 'BNB' }] }), {
    status: 200,
    headers: { 'content-type': 'application/json', 'payment-response': base64(settlement) },
  });
}

/** Plays back one queued outcome per call: a Response to return or an Error to throw. */
function stubFetch(steps: Array<Response | Error>) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const fetchImpl = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const headers = Object.fromEntries(
      Object.entries((init?.headers ?? {}) as Record<string, string>),
    );
    calls.push({ url: String(input), headers });

    const next = steps.shift();
    if (next === undefined) {
      throw new Error('the test ran out of queued responses');
    }
    if (next instanceof Error) {
      throw next;
    }
    return next;
  }) as unknown as typeof fetch;

  return { fetchImpl, calls };
}

const readyOption = {
  index: 1,
  status: 'READY_TO_SIGN',
  reasons: [],
  scheme: 'exact',
  assetTransferMethod: 'eip3009',
  binanceChainId: '56',
  tokenAddress: '0xcE24439F2D9C6a2289F741120FE202248B666666',
  tokenSymbol: 'U',
  amount: '0.010000000000000000',
  amountUsd: '0.00999461745320416387871076266416549010000000000000000',
  payTo: '0x93053f1e7A5eFEDa532Fe69CbbE43cBEc3A0F13f',
  userWalletAddress: '0xC75126992E4744a75665405e9b427710C0d23052',
  needApproveFirst: false,
};

const brokeOption = {
  ...readyOption,
  status: 'ACTION_REQUIRED',
  reasons: ['INSUFFICIENT_BALANCE'],
};

function stubBaw(preview: { paymentId: string; options: unknown[] }) {
  const calls: string[][] = [];
  const run: BawRunner = async (args) => {
    calls.push(args);

    if (args[1] === 'preview') {
      return { stdout: JSON.stringify({ success: true, data: preview }), exitCode: 0 };
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

  return { baw: new Baw({ run }), calls, signCount: () => calls.filter((c) => c[1] === 'sign').length };
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

describe('buy', () => {
  it('returns the body untouched when the endpoint is free', async () => {
    const { fetchImpl } = stubFetch([
      new Response(JSON.stringify({ price: 1234 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ]);
    const { baw, calls } = stubBaw({ paymentId: 'free-1', options: [] });

    const outcome = await buy(
      { url: URL_UNDER_TEST },
      { dryRun: true, maxUsdPerCall: 0.05, fetch: fetchImpl, baw, ...memorySignatureGuard() },
    );

    expect(outcome).toEqual({ status: 'free', data: { price: 1234 } });
    expect(calls).toHaveLength(0);
  });

  it('refuses an x402 v1 merchant without asking the wallet', async () => {
    const { fetchImpl } = stubFetch([paymentRequiredResponse({ ...nansen402, x402Version: 1 })]);
    const { baw, calls } = stubBaw({ paymentId: 'v1-1', options: [readyOption] });

    const outcome = await buy(
      { url: URL_UNDER_TEST },
      { dryRun: true, maxUsdPerCall: 0.05, fetch: fetchImpl, baw, ...memorySignatureGuard() },
    );

    expect(outcome).toEqual({
      status: 'refused',
      reason: 'x402 v1 not supported by the Binance wallet',
      costUsd: 0.01,
    });
    expect(calls).toHaveLength(0);
  });

  it('refuses and repeats the wallet reasons when nothing is signable', async () => {
    const { fetchImpl } = stubFetch([paymentRequiredResponse()]);
    const { baw, signCount } = stubBaw({ paymentId: 'broke-1', options: [brokeOption] });

    const outcome = await buy(
      { url: URL_UNDER_TEST },
      { dryRun: false, maxUsdPerCall: 0.05, fetch: fetchImpl, baw, ...memorySignatureGuard() },
    );

    expect(outcome).toEqual({
      status: 'refused',
      reason: 'INSUFFICIENT_BALANCE',
      costUsd: 0.01,
      paymentId: 'broke-1',
    });
    expect(signCount()).toBe(0);
  });

  it('refuses a call priced above the per call cap before anything is signed', async () => {
    const { fetchImpl } = stubFetch([paymentRequiredResponse()]);
    const { baw, signCount } = stubBaw({
      paymentId: 'dear-1',
      options: [{ ...readyOption, amountUsd: '0.2500' }],
    });

    const outcome = await buy(
      { url: URL_UNDER_TEST },
      { dryRun: false, maxUsdPerCall: 0.05, fetch: fetchImpl, baw, ...memorySignatureGuard() },
    );

    expect(outcome).toMatchObject({ status: 'refused', costUsd: 0.25, paymentId: 'dear-1' });
    expect(outcome.status === 'refused' && outcome.reason).toContain('over the $0.0500 cap');
    expect(signCount()).toBe(0);
  });

  it('stops before the signature in dry run and reports what it would have paid', async () => {
    const { fetchImpl, calls } = stubFetch([paymentRequiredResponse()]);
    const { baw, signCount } = stubBaw({ paymentId: 'dry-1', options: [brokeOption, readyOption] });

    const outcome = await buy(
      { url: URL_UNDER_TEST, method: 'POST', body: { chain: 'bsc' } },
      { dryRun: true, maxUsdPerCall: 0.05, fetch: fetchImpl, baw, ...memorySignatureGuard() },
    );

    expect(outcome).toMatchObject({ status: 'dry-run', paymentId: 'dry-1' });
    expect(outcome.status === 'dry-run' && outcome.option.index).toBe(1);
    expect(outcome.status === 'dry-run' && outcome.costUsd).toBeCloseTo(0.00999, 5);
    expect(signCount()).toBe(0);
    expect(calls).toHaveLength(1);
  });

  it('signs once, replays with the payment header and reads the settlement hash', async () => {
    const { fetchImpl, calls } = stubFetch([
      paymentRequiredResponse(),
      paidResponse({ success: true, txHash: '0xabc123', network: 'eip155:56' }),
    ]);
    const { baw, signCount } = stubBaw({ paymentId: 'paid-1', options: [readyOption] });

    const outcome = await buy(
      { url: URL_UNDER_TEST },
      { dryRun: false, maxUsdPerCall: 0.05, fetch: fetchImpl, baw, ...memorySignatureGuard() },
    );

    expect(outcome).toMatchObject({
      status: 'paid',
      txHash: '0xabc123',
      paymentId: 'paid-1',
      data: { data: [{ token_symbol: 'BNB' }] },
      settlement: { success: true, txHash: '0xabc123', network: 'eip155:56' },
    });
    expect(signCount()).toBe(1);
    expect(calls[1]?.headers['PAYMENT-SIGNATURE']).toBe('eyJ4NDAyVmVyc2lvbiI6Mi4uLg==');
  });

  it('retries the paid call once on a network error and never signs a second time', async () => {
    const { fetchImpl } = stubFetch([
      paymentRequiredResponse(),
      new Error('socket hang up'),
      paidResponse({ txHash: '0xretry' }),
    ]);
    const { baw, signCount } = stubBaw({ paymentId: 'retry-1', options: [readyOption] });

    const outcome = await buy(
      { url: URL_UNDER_TEST },
      { dryRun: false, maxUsdPerCall: 0.05, fetch: fetchImpl, baw, ...memorySignatureGuard() },
    );

    expect(outcome).toMatchObject({ status: 'paid', txHash: '0xretry' });
    expect(signCount()).toBe(1);
  });

  it('gives up after the second failed replay and says the money may be gone', async () => {
    const { fetchImpl } = stubFetch([
      paymentRequiredResponse(),
      new Error('socket hang up'),
      new Error('socket hang up again'),
    ]);
    const { baw, signCount } = stubBaw({ paymentId: 'retry-2', options: [readyOption] });

    const outcome = await buy(
      { url: URL_UNDER_TEST },
      { dryRun: false, maxUsdPerCall: 0.05, fetch: fetchImpl, baw, ...memorySignatureGuard() },
    );

    expect(outcome).toEqual({
      status: 'failed',
      reason: 'paid call failed twice: socket hang up again',
      paymentId: 'retry-2',
    });
    expect(signCount()).toBe(1);
  });

  it('refuses to sign the same payment id twice behind one memory guard', async () => {
    const first = stubFetch([
      paymentRequiredResponse(),
      paidResponse({ txHash: '0xonce' }),
    ]);
    const second = stubFetch([paymentRequiredResponse()]);
    const { baw, signCount } = stubBaw({ paymentId: 'once-1', options: [readyOption] });
    const guard = memorySignatureGuard();

    const paid = await buy(
      { url: URL_UNDER_TEST },
      { dryRun: false, maxUsdPerCall: 0.05, fetch: first.fetchImpl, baw, ...guard },
    );
    const again = await buy(
      { url: URL_UNDER_TEST },
      { dryRun: false, maxUsdPerCall: 0.05, fetch: second.fetchImpl, baw, ...guard },
    );

    expect(paid.status).toBe('paid');
    expect(again).toEqual({
      status: 'failed',
      reason: 'this payment was already signed once, Olai will not sign it again',
      paymentId: 'once-1',
    });
    expect(signCount()).toBe(1);
  });

  it('writes the signature claim to the ledger before it asks the wallet to sign', async () => {
    const ledger = openLedger();
    const { fetchImpl } = stubFetch([paymentRequiredResponse(), paidResponse({ txHash: '0xclaim' })]);
    const { baw, signCount } = stubBaw({ paymentId: 'claim-1', options: [readyOption] });

    const outcome = await buy(
      { url: URL_UNDER_TEST },
      {
        dryRun: false,
        maxUsdPerCall: 0.05,
        fetch: fetchImpl,
        baw,
        ...ledgerSignatureGuard(ledger),
      },
    );

    expect(outcome.status).toBe('paid');
    expect(signCount()).toBe(1);

    const claim = ledger.list({ kinds: ['payment.signed'] })[0];
    expect(claim?.payload).toMatchObject({ paymentId: 'claim-1', url: URL_UNDER_TEST });
    expect(claim?.costUsd).toBe(0.01);
  });

  it('refuses a payment a previous run already signed, which the memory set has forgotten', async () => {
    const ledger = openLedger();
    // Written the way the guard writes it, standing in for a run that signed
    // this payment and then died before the merchant answered.
    ledger.append({
      kind: 'payment.signed',
      actor: 'agent',
      costUsd: 0.01,
      payload: { summary: 'a previous run signed this', paymentId: 'restart-1', url: URL_UNDER_TEST },
    });

    const { fetchImpl } = stubFetch([paymentRequiredResponse()]);
    const { baw, signCount } = stubBaw({ paymentId: 'restart-1', options: [readyOption] });

    const outcome = await buy(
      { url: URL_UNDER_TEST },
      {
        dryRun: false,
        maxUsdPerCall: 0.05,
        fetch: fetchImpl,
        baw,
        ...ledgerSignatureGuard(ledger),
      },
    );

    expect(outcome).toEqual({
      status: 'failed',
      reason: 'this payment was already signed once, Olai will not sign it again',
      paymentId: 'restart-1',
    });
    expect(signCount()).toBe(0);
    expect(ledger.list({ kinds: ['payment.signed'] })).toHaveLength(1);
  });

  it('will not compile without somewhere to record the signature', async () => {
    const { fetchImpl } = stubFetch([paymentRequiredResponse()]);
    const { baw } = stubBaw({ paymentId: 'types-1', options: [readyOption] });

    // A caller with no guard is a caller that could pay the same bill twice, so
    // the type system turns it away before the test ever runs.
    // @ts-expect-error alreadySigned and markSigned are both required
    await buy({ url: URL_UNDER_TEST }, { dryRun: true, maxUsdPerCall: 0.05, fetch: fetchImpl, baw });
  });

  it('prefers the chain the caller asked for among the signable options', async () => {
    const { fetchImpl } = stubFetch([paymentRequiredResponse()]);
    const { baw } = stubBaw({
      paymentId: 'chain-1',
      options: [
        { ...readyOption, index: 1, binanceChainId: '8453', tokenSymbol: 'USDC' },
        { ...readyOption, index: 2, binanceChainId: '56', tokenSymbol: 'USD1' },
      ],
    });

    const outcome = await buy(
      { url: URL_UNDER_TEST },
      { dryRun: true, maxUsdPerCall: 0.05, fetch: fetchImpl, baw, ...memorySignatureGuard() },
    );

    expect(outcome.status === 'dry-run' && outcome.option.tokenSymbol).toBe('USD1');
  });
});
