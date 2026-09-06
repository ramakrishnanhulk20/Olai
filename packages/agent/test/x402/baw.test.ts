import { describe, expect, it } from 'vitest';
import { Baw, BawError, type BawRunner } from '../../src/x402/baw.js';

// What this file does NOT cover: the real `baw` binary and its session handling.
// Every response here is a fake runner replaying the shapes the Binance skill docs
// publish and the live output recorded in spikes/wallet/RESULT.md.

function runnerFor(stdout: unknown, exitCode = 0) {
  const calls: string[][] = [];
  const run: BawRunner = async (args) => {
    calls.push(args);
    return { stdout: typeof stdout === 'string' ? stdout : JSON.stringify(stdout), exitCode };
  };
  return { run, calls };
}

describe('Baw', () => {
  it('reads the wallet connection state', async () => {
    const { run, calls } = runnerFor({ success: true, data: { status: 'CONNECTED' } });

    await expect(new Baw({ run }).walletStatus()).resolves.toBe('CONNECTED');
    expect(calls[0]).toEqual(['wallet', 'status', '--json']);
  });

  it('keeps only the quota fields Olai needs from the settings blob', async () => {
    const { run } = runnerFor({
      success: true,
      data: {
        dailyLimit: 50000,
        x402DailyLimit: 20,
        x402QuotaUsed: 0,
        x402QuotaLeft: 20,
        abnormalTxnHandling: 'AutoReject',
        sessionExpireTime: '2026-09-08T02:11:30+05:30',
      },
    });

    await expect(new Baw({ run }).walletSettings()).resolves.toEqual({
      dailyLimit: 50000,
      x402DailyLimit: 20,
      x402QuotaUsed: 0,
      x402QuotaLeft: 20,
      abnormalTxnHandling: 'AutoReject',
    });
  });

  it('passes the payment requirements as one argument and drops wallet only fields from the options', async () => {
    const { run, calls } = runnerFor({
      success: true,
      data: {
        paymentId: 'cad7a9c3-b3f0-4c15-84a1-554ec32f9f02',
        options: [
          {
            index: 1,
            status: 'ACTION_REQUIRED',
            reasons: ['INSUFFICIENT_BALANCE'],
            scheme: 'exact',
            assetTransferMethod: 'eip3009',
            binanceChainId: '56',
            tokenAddress: '0xcE24439F2D9C6a2289F741120FE202248B666666',
            tokenSymbol: 'U',
            amount: '0.010000000000000000',
            amountUsd: '0.009994617453204163',
            payTo: '0x93053f1e7A5eFEDa532Fe69CbbE43cBEc3A0F13f',
            userWalletAddress: '0xC75126992E4744a75665405e9b427710C0d23052',
            currentBalance: '0.000000000000000000',
            needApproveFirst: false,
          },
        ],
      },
    });

    const preview = await new Baw({ run }).x402Preview({ x402Version: 2, accepts: [] });

    expect(calls[0]).toEqual([
      'x402-payment',
      'preview',
      '--paymentRequirements',
      '{"x402Version":2,"accepts":[]}',
      '--json',
    ]);
    expect(preview.paymentId).toBe('cad7a9c3-b3f0-4c15-84a1-554ec32f9f02');
    expect(preview.options[0]).toEqual({
      index: 1,
      status: 'ACTION_REQUIRED',
      reasons: ['INSUFFICIENT_BALANCE'],
      scheme: 'exact',
      assetTransferMethod: 'eip3009',
      binanceChainId: '56',
      tokenSymbol: 'U',
      amount: '0.010000000000000000',
      amountUsd: '0.009994617453204163',
      payTo: '0x93053f1e7A5eFEDa532Fe69CbbE43cBEc3A0F13f',
      needApproveFirst: false,
    });
  });

  it('turns the CLI error object into a typed error', async () => {
    const { run } = runnerFor(
      {
        success: false,
        error: { code: 351740, name: 'SERVICE_ERROR', message: 'invalid payment requirements' },
      },
      1,
    );

    await expect(new Baw({ run }).x402Preview('{}')).rejects.toThrowError(BawError);
    await expect(new Baw({ run }).x402Preview('{}')).rejects.toThrowError(
      /invalid payment requirements/,
    );
  });

  it('refuses a zero based index rather than signing the wrong option', async () => {
    const { run, calls } = runnerFor({ success: true, data: {} });

    await expect(new Baw({ run }).x402Sign('payment-1', 0)).rejects.toThrowError(/1 based index/);
    expect(calls).toHaveLength(0);
  });
});
