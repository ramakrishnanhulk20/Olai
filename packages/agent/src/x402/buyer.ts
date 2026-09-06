import { priceUsdFromAccepts } from '../bazaar/tokens.js';
import type { Baw, X402Option } from './baw.js';
import { log } from './log.js';
import {
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_RESPONSE_HEADER,
  decodePaymentRequired,
  decodeSettlement,
  pricedAccepts,
  txHashFromSettlement,
} from './paymentRequired.js';

/**
 * One paid HTTP call, start to finish: ask the merchant, read its price, ask the
 * Binance wallet what it can sign, check the price against the cap, sign once, and
 * replay. Every exit is a named outcome rather than an exception, because "we did
 * not pay, and here is why" is a normal answer for an agent that spends money.
 */

export interface BuyRequest {
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: unknown;
}

export type BuyOutcome =
  | {
      status: 'paid';
      data: unknown;
      costUsd: number;
      txHash: string | null;
      paymentId: string;
      option: X402Option;
      settlement: unknown;
    }
  | { status: 'dry-run'; costUsd: number; paymentId: string; option: X402Option }
  | { status: 'free'; data: unknown }
  | { status: 'refused'; reason: string; costUsd: number | null; paymentId?: string }
  | { status: 'failed'; reason: string; paymentId?: string };

export interface BuyerOptions {
  dryRun: boolean;
  maxUsdPerCall: number;
  preferChainIds?: string[];
  fetch?: typeof fetch;
  baw: Baw;
  /**
   * Has this payment id been signed before, in any run? There is no fallback
   * inside this file on purpose: a caller that cannot say where its record of
   * past signatures lives has no business signing anything.
   */
  alreadySigned: (paymentId: string) => boolean;
  /**
   * Write the claim down before the signature is asked for. If this throws,
   * nothing is signed: an unrecordable payment is one Olai will not make.
   */
  markSigned: (paymentId: string, info: { url: string; costUsd: number }) => void;
}

const REQUEST_TIMEOUT_MS = 30_000;

// BSC first: it is where nearly every Bazaar merchant settles, its stablecoins are
// the ones the Binance wallet signs without a Permit2 approve, and its fees are the
// cheapest of the three supported chains.
const DEFAULT_PREFERRED_CHAINS = ['56'];

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function send(
  req: BuyRequest,
  fetchImpl: typeof fetch,
  extraHeaders: Record<string, string>,
): Promise<Response> {
  const method = req.method ?? 'GET';
  const headers: Record<string, string> = { accept: 'application/json', ...req.headers, ...extraHeaders };

  let body: string | undefined;
  if (method === 'POST' && req.body !== undefined) {
    body = JSON.stringify(req.body);
    if (!Object.keys(headers).some((name) => name.toLowerCase() === 'content-type')) {
      headers['content-type'] = 'application/json';
    }
  }

  return fetchImpl(req.url, {
    method,
    headers,
    ...(body === undefined ? {} : { body }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

function readBody(response: Response, text: string): unknown {
  const type = response.headers.get('content-type') ?? '';
  if (!type.includes('json')) {
    return text;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/** Preferred chain wins, then the wallet's own ranking, which already puts the cheapest and approval free options first. */
function pickOption(options: X402Option[], preferChainIds: string[]): X402Option | null {
  const ready = options.filter((option) => option.status === 'READY_TO_SIGN');
  if (ready.length === 0) {
    return null;
  }

  for (const chainId of preferChainIds) {
    const match = ready.find((option) => option.binanceChainId === chainId);
    if (match) {
      return match;
    }
  }

  return ready[0] ?? null;
}

/**
 * The wallet quotes amountUsd at the live token price. When it is missing, the raw
 * token amount is the fallback, which holds because every asset a merchant accepts
 * here is a dollar stablecoin. Null means Olai could not read a price at all.
 */
function optionCostUsd(option: X402Option): number | null {
  for (const raw of [option.amountUsd, option.amount]) {
    if (raw === undefined) {
      continue;
    }
    const value = Number(raw);
    if (Number.isFinite(value) && value >= 0) {
      return value;
    }
  }

  return null;
}

export async function buy(req: BuyRequest, opts: BuyerOptions): Promise<BuyOutcome> {
  const fetchImpl = opts.fetch ?? fetch;
  const preferChainIds = opts.preferChainIds ?? DEFAULT_PREFERRED_CHAINS;

  let first: Response;
  try {
    first = await send(req, fetchImpl, {});
  } catch (error) {
    return { status: 'failed', reason: `could not reach ${req.url}: ${message(error)}` };
  }

  const firstText = await first.text();

  if (first.status !== 402) {
    if (!first.ok) {
      return { status: 'failed', reason: `merchant returned HTTP ${first.status}` };
    }
    return { status: 'free', data: readBody(first, firstText) };
  }

  const paymentRequired = decodePaymentRequired(
    first.headers.get(PAYMENT_REQUIRED_HEADER),
    firstText,
  );
  if (!paymentRequired) {
    return {
      status: 'failed',
      reason: 'merchant asked for payment but sent no readable PaymentRequired object',
    };
  }

  const listedUsd = priceUsdFromAccepts(pricedAccepts(paymentRequired));

  if (paymentRequired.x402Version !== 2) {
    log.info({ url: req.url, x402Version: paymentRequired.x402Version }, 'x402 payment refused');
    return {
      status: 'refused',
      reason: 'x402 v1 not supported by the Binance wallet',
      costUsd: listedUsd,
    };
  }

  let preview;
  try {
    preview = await opts.baw.x402Preview(paymentRequired);
  } catch (error) {
    // The wallet turning a merchant down (a malformed v2 payload, an unsupported
    // chain) is a refusal to pay, not a broken Olai: the merchant is skipped and
    // the reason goes on the record.
    const reason = `the Binance wallet would not price this merchant: ${message(error)}`;
    log.info({ url: req.url, reason }, 'x402 payment refused');
    return { status: 'refused', reason, costUsd: listedUsd };
  }

  const option = pickOption(preview.options, preferChainIds);

  if (!option) {
    const reasons = [...new Set(preview.options.flatMap((entry) => entry.reasons))];
    const reason =
      reasons.length > 0 ? reasons.join(', ') : 'the wallet offered no signable payment option';
    log.info({ url: req.url, paymentId: preview.paymentId, reason }, 'x402 payment refused');
    return { status: 'refused', reason, costUsd: listedUsd, paymentId: preview.paymentId };
  }

  const costUsd = optionCostUsd(option) ?? listedUsd;

  if (costUsd === null) {
    const reason = 'the wallet returned no price for this option, so Olai will not pay it';
    log.info({ url: req.url, paymentId: preview.paymentId, reason }, 'x402 payment refused');
    return { status: 'refused', reason, costUsd: null, paymentId: preview.paymentId };
  }

  // Compared at the cent, because the wallet quotes the live token price and a
  // cent is the smallest thing either side can charge.
  if (Math.round(costUsd * 100) > Math.round(opts.maxUsdPerCall * 100)) {
    const reason = `this call costs $${costUsd.toFixed(4)}, over the $${opts.maxUsdPerCall.toFixed(4)} cap for a single call`;
    log.info({ url: req.url, paymentId: preview.paymentId, costUsd }, 'x402 payment refused');
    return { status: 'refused', reason, costUsd, paymentId: preview.paymentId };
  }

  if (opts.dryRun) {
    log.info(
      {
        url: req.url,
        paymentId: preview.paymentId,
        costUsd,
        chain: option.binanceChainId,
        token: option.tokenSymbol,
      },
      'x402 payment stopped before signing, dry run',
    );
    return { status: 'dry-run', costUsd, paymentId: preview.paymentId, option };
  }

  if (opts.alreadySigned(preview.paymentId)) {
    return {
      status: 'failed',
      reason: 'this payment was already signed once, Olai will not sign it again',
      paymentId: preview.paymentId,
    };
  }

  // Claimed before the call, not after, so a thrown signature still counts as used.
  try {
    opts.markSigned(preview.paymentId, { url: req.url, costUsd });
  } catch (error) {
    log.error(
      { url: req.url, paymentId: preview.paymentId, err: error },
      'could not record the signature claim, nothing was signed',
    );
    return {
      status: 'failed',
      reason: `Olai could not write down that it is about to pay, so it did not: ${message(error)}`,
      paymentId: preview.paymentId,
    };
  }

  let signed;
  try {
    signed = await opts.baw.x402Sign(preview.paymentId, option.index);
  } catch (error) {
    return {
      status: 'failed',
      reason: `wallet refused to sign: ${message(error)}`,
      paymentId: preview.paymentId,
    };
  }

  log.info(
    {
      url: req.url,
      paymentId: preview.paymentId,
      costUsd,
      chain: option.binanceChainId,
      token: option.tokenSymbol,
      payTo: option.payTo,
      expiresAt: signed.signatureExpiresAt,
    },
    'x402 payment signed',
  );

  if (signed.approveTxHash) {
    log.warn(
      { paymentId: preview.paymentId, approveTxHash: signed.approveTxHash },
      'wallet dispatched a Permit2 approve alongside the signature, the merchant may reject the replay until it confirms',
    );
  }

  let replay: Response | null = null;
  let lastError = '';
  // One retry only. A signature is valid until signatureExpiresAt and can be used
  // once, so hammering the merchant risks burning it against a broken connection.
  for (let attempt = 0; attempt < 2 && replay === null; attempt += 1) {
    try {
      replay = await send(req, fetchImpl, {
        [signed.paymentHeaderName]: signed.paymentHeaderValue,
      });
    } catch (error) {
      lastError = message(error);
    }
  }

  if (replay === null) {
    log.error(
      { url: req.url, paymentId: preview.paymentId, costUsd, lastError },
      'x402 payment signed but the merchant never answered, money may be spent',
    );
    return {
      status: 'failed',
      reason: `paid call failed twice: ${lastError}`,
      paymentId: preview.paymentId,
    };
  }

  const replayText = await replay.text();

  if (!replay.ok) {
    log.error(
      { url: req.url, paymentId: preview.paymentId, httpStatus: replay.status },
      'x402 payment signed but the merchant rejected the paid call',
    );
    return {
      status: 'failed',
      reason: `merchant returned HTTP ${replay.status} to the paid call`,
      paymentId: preview.paymentId,
    };
  }

  const settlement = decodeSettlement(replay.headers.get(PAYMENT_RESPONSE_HEADER));
  const txHash = txHashFromSettlement(settlement);

  log.info(
    { url: req.url, paymentId: preview.paymentId, costUsd, txHash },
    'x402 payment settled',
  );

  return {
    status: 'paid',
    data: readBody(replay, replayText),
    costUsd,
    txHash,
    paymentId: preview.paymentId,
    option,
    settlement,
  };
}
