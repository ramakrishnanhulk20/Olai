import { execa } from 'execa';
import { z } from 'zod';

/**
 * Thin, typed wrapper around the Binance Agentic Wallet CLI (`baw`). Every call
 * goes through one runner so tests can hand in a fake and so no other part of Olai
 * ever builds a wallet command by hand.
 *
 * The CLI holds the session; Olai holds no key material at all. Nothing here
 * moves money except x402Sign, and that is called from exactly one place.
 */

export type BawRunner = (args: string[]) => Promise<{ stdout: string; exitCode: number }>;

export interface X402Option {
  index: number;
  status: 'READY_TO_SIGN' | 'ACTION_REQUIRED' | 'NOT_SIGNABLE';
  reasons: string[];
  scheme: string;
  assetTransferMethod?: string;
  binanceChainId?: string;
  tokenSymbol?: string;
  amount?: string;
  amountUsd?: string;
  payTo?: string;
  needApproveFirst?: boolean;
}

export interface X402Preview {
  paymentId: string;
  options: X402Option[];
}

export class BawError extends Error {
  constructor(
    readonly command: string,
    message: string,
  ) {
    super(message);
    this.name = 'BawError';
  }
}

const CLI_TIMEOUT_MS = 120_000;

const defaultRunner: BawRunner = async (args) => {
  // reject:false because `baw` prints a structured error object and exits 1 for
  // ordinary refusals like "insufficient balance", which is data, not a crash.
  // No shell: the payment payload comes from a merchant and must never be parsed
  // by a command line.
  const result = await execa('baw', args, { reject: false, timeout: CLI_TIMEOUT_MS });
  return { stdout: result.stdout ?? '', exitCode: result.exitCode ?? 1 };
};

const envelopeSchema = z.looseObject({
  success: z.boolean(),
  // A refusal carries an error object and no data at all, so this stays optional.
  data: z.unknown().optional(),
  error: z
    .looseObject({ code: z.union([z.number(), z.string()]).optional(), message: z.string() })
    .nullish(),
});

const text = z.union([z.string(), z.number()]).transform(String);

const statusSchema = z.looseObject({ status: z.enum(['CONNECTED', 'UNCONNECTED']) });

const settingsSchema = z.looseObject({
  x402DailyLimit: z.number(),
  x402QuotaUsed: z.number(),
  x402QuotaLeft: z.number(),
  dailyLimit: z.number(),
  abnormalTxnHandling: z.string(),
});

// The CLI's live shape (symbol, address, price, value) differs from the one in
// its own docs (tokenSymbol, tokenAddress, balanceUsd); both are accepted so a
// docs-shaped fixture and a real wallet read parse the same way.
const balanceSchema = z.array(
  z.looseObject({
    binanceChainId: text,
    symbol: z.string().optional(),
    tokenSymbol: z.string().optional(),
    address: z.string().optional(),
    tokenAddress: z.string().optional(),
    balance: text,
    value: text.optional(),
    balanceUsd: text.optional(),
  }),
);

const optionSchema = z.looseObject({
  index: z.number(),
  status: z.enum(['READY_TO_SIGN', 'ACTION_REQUIRED', 'NOT_SIGNABLE']),
  reasons: z.array(z.string()).default([]),
  scheme: z.string(),
  // An option the wallet cannot sign at all comes back with these fields set to
  // null rather than left out, so every one of them has to accept null.
  assetTransferMethod: z.string().nullish(),
  binanceChainId: text.nullish(),
  tokenSymbol: z.string().nullish(),
  amount: text.nullish(),
  amountUsd: text.nullish(),
  payTo: z.string().nullish(),
  needApproveFirst: z.boolean().nullish(),
});

const previewSchema = z.looseObject({
  paymentId: z.string(),
  options: z.array(optionSchema).default([]),
});

const signSchema = z.looseObject({
  paymentHeaderName: z.string(),
  paymentHeaderValue: z.string(),
  approveTxHash: z.string().nullish(),
  binanceChainId: text.nullish(),
  signatureExpiresAt: z.number(),
});

/** Keeps only the fields Olai's own interface promises, so wallet balances and addresses do not leak into the rest of the agent. */
function toOption(raw: z.infer<typeof optionSchema>): X402Option {
  const option: X402Option = {
    index: raw.index,
    status: raw.status,
    reasons: raw.reasons,
    scheme: raw.scheme,
  };

  if (raw.assetTransferMethod != null) option.assetTransferMethod = raw.assetTransferMethod;
  if (raw.binanceChainId != null) option.binanceChainId = raw.binanceChainId;
  if (raw.tokenSymbol != null) option.tokenSymbol = raw.tokenSymbol;
  if (raw.amount != null) option.amount = raw.amount;
  if (raw.amountUsd != null) option.amountUsd = raw.amountUsd;
  if (raw.payTo != null) option.payTo = raw.payTo;
  if (raw.needApproveFirst != null) option.needApproveFirst = raw.needApproveFirst;

  return option;
}

export class Baw {
  private readonly run: BawRunner;

  constructor(opts?: { run?: BawRunner }) {
    this.run = opts?.run ?? defaultRunner;
  }

  async walletStatus(): Promise<'CONNECTED' | 'UNCONNECTED'> {
    const data = await this.call(['wallet', 'status']);
    return statusSchema.parse(data).status;
  }

  async walletSettings(): Promise<{
    x402DailyLimit: number;
    x402QuotaUsed: number;
    x402QuotaLeft: number;
    dailyLimit: number;
    abnormalTxnHandling: string;
  }> {
    const parsed = settingsSchema.parse(await this.call(['wallet', 'settings']));

    return {
      x402DailyLimit: parsed.x402DailyLimit,
      x402QuotaUsed: parsed.x402QuotaUsed,
      x402QuotaLeft: parsed.x402QuotaLeft,
      dailyLimit: parsed.dailyLimit,
      abnormalTxnHandling: parsed.abnormalTxnHandling,
    };
  }

  async walletBalance(): Promise<
    Array<{
      binanceChainId: string;
      tokenSymbol: string;
      tokenAddress: string;
      balance: string;
      balanceUsd: string;
    }>
  > {
    const parsed = balanceSchema.parse(await this.call(['wallet', 'balance']));

    return parsed.map((entry) => ({
      binanceChainId: entry.binanceChainId,
      tokenSymbol: entry.tokenSymbol ?? entry.symbol ?? '',
      tokenAddress: entry.tokenAddress ?? entry.address ?? '',
      balance: entry.balance,
      balanceUsd: entry.balanceUsd ?? entry.value ?? '',
    }));
  }

  /**
   * Asks the wallet what it could pay against a merchant's PaymentRequired object.
   * Read only: it ranks the options and says why each one is or is not signable.
   * It never signs and never moves money.
   */
  async x402Preview(paymentRequirements: string | object): Promise<X402Preview> {
    const payload =
      typeof paymentRequirements === 'string'
        ? paymentRequirements
        : JSON.stringify(paymentRequirements);

    const data = await this.call([
      'x402-payment',
      'preview',
      '--paymentRequirements',
      payload,
    ]);
    const parsed = previewSchema.parse(data);

    return { paymentId: parsed.paymentId, options: parsed.options.map(toOption) };
  }

  /**
   * Signs one previewed option. This is the only call in Olai that spends money,
   * and the signature it returns is single use.
   */
  async x402Sign(
    paymentId: string,
    selectedIndex: number,
  ): Promise<{
    paymentHeaderName: string;
    paymentHeaderValue: string;
    approveTxHash: string | null;
    binanceChainId: string | null;
    signatureExpiresAt: number;
  }> {
    if (!paymentId) {
      throw new BawError('x402-payment sign', 'paymentId is required');
    }
    if (!Number.isInteger(selectedIndex) || selectedIndex < 1) {
      throw new BawError(
        'x402-payment sign',
        `selectedIndex must be the 1 based index from preview, got ${String(selectedIndex)}`,
      );
    }

    const parsed = signSchema.parse(
      await this.call([
        'x402-payment',
        'sign',
        '--paymentId',
        paymentId,
        '--selectedIndex',
        String(selectedIndex),
      ]),
    );

    return {
      paymentHeaderName: parsed.paymentHeaderName,
      paymentHeaderValue: parsed.paymentHeaderValue,
      approveTxHash: parsed.approveTxHash ?? null,
      binanceChainId: parsed.binanceChainId ?? null,
      signatureExpiresAt: parsed.signatureExpiresAt,
    };
  }

  async txHistory(q: { tx?: string; binanceChainId?: string; size?: number }): Promise<unknown> {
    const args = ['wallet', 'tx-history'];
    if (q.tx) args.push('--tx', q.tx);
    if (q.binanceChainId) args.push('--binanceChainId', q.binanceChainId);
    if (q.size !== undefined) args.push('--size', String(q.size));

    return this.call(args);
  }

  private async call(args: string[]): Promise<unknown> {
    const command = args.slice(0, 2).join(' ');
    const { stdout, exitCode } = await this.run([...args, '--json']);
    const trimmed = stdout.trim();

    let payload: unknown;
    try {
      payload = JSON.parse(trimmed) as unknown;
    } catch {
      throw new BawError(
        command,
        `baw ${command} exited ${exitCode} without JSON: ${trimmed.slice(0, 300)}`,
      );
    }

    const envelope = envelopeSchema.parse(payload);

    if (!envelope.success) {
      throw new BawError(command, envelope.error?.message ?? `baw ${command} failed`);
    }

    return envelope.data;
  }
}
