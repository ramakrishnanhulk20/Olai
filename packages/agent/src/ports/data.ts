import type { BazaarClient, BazaarResource } from '../bazaar/client.js';
import type { Ledger } from '../ledger/ledger.js';
import type { Baw } from '../x402/baw.js';
import { type BuyOutcome, type BuyRequest, buy } from '../x402/buyer.js';

/**
 * The paid-data door. Search the B402 Bazaar, then pay a merchant per call over
 * x402 from the Binance Agentic Wallet.
 *
 * The cap is an argument on every buy rather than a setting on the port. The
 * caller works the cap out from the rulebook at the moment it spends, so a
 * rulebook edit takes effect on the very next call.
 */
export interface DataPort {
  search(q: { query: string; maxUsdPrice: number }): Promise<BazaarResource[]>;
  buy(req: BuyRequest, maxUsdPerCall: number): Promise<BuyOutcome>;
}

// The Bazaar search endpoint pages at 20 and has no cursor, so one page is the
// whole result set Olai can see for a query.
const SEARCH_LIMIT = 20;

export interface SignatureGuard {
  alreadySigned: (paymentId: string) => boolean;
  markSigned: (paymentId: string, info: { url: string; costUsd: number }) => void;
}

/**
 * The one-signature rule for callers with nothing durable to write to: probes,
 * demos and tests. It forgets everything when the process ends, which is why
 * anything that can really spend money uses the ledger guard below instead.
 */
export function memorySignatureGuard(): SignatureGuard {
  const signed = new Set<string>();

  return {
    alreadySigned: (paymentId) => signed.has(paymentId),
    markSigned: (paymentId) => {
      signed.add(paymentId);
    },
  };
}

/**
 * The one-signature rule, written down where a restart cannot forget it.
 *
 * A set in memory dies with the process. The ledger does not, so a crash
 * between the signature and the merchant's answer cannot come back and pay the
 * same bill twice.
 *
 * The claim is written before the wallet is asked to sign, which is the order
 * that matters: a claim with no payment costs nothing, a payment with no claim
 * is money nobody can account for.
 */
export function ledgerSignatureGuard(ledger: Ledger): SignatureGuard {
  return {
    alreadySigned: (paymentId) =>
      ledger
        .list({ kinds: ['payment.signed'] })
        .some((entry) => entry.payload['paymentId'] === paymentId),

    markSigned: (paymentId, info) => {
      ledger.append({
        kind: 'payment.signed',
        actor: 'agent',
        costUsd: info.costUsd,
        payload: {
          summary: `About to sign one payment of $${info.costUsd.toFixed(4)} for ${info.url}`,
          paymentId,
          url: info.url,
        },
      });
    },
  };
}

/**
 * One payment at a time in this process, whichever session asked.
 *
 * Checking the budget and then spending against it are two steps. Two sessions
 * running at once would each read the same "spent so far" and each decide there
 * was room, so the day's data budget could be passed by both of them together.
 * The queue makes the check and the payment one step that nothing interleaves
 * with. Order does not matter here, only that they do not overlap.
 */
let paymentQueue: Promise<unknown> = Promise.resolve();

export function withPaymentLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = paymentQueue.then(fn, fn);
  // The queue must keep moving after a failed payment, so its own copy of the
  // promise swallows the error. The caller still gets the rejection.
  paymentQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * The real data port: Binance's Bazaar for discovery, the Binance Agentic
 * Wallet for payment.
 *
 * dryRun is fixed at construction because it describes the process, not the
 * call. A dry run still previews the price with the wallet, it just never signs.
 */
export function bazaarDataPort(deps: {
  bazaar: BazaarClient;
  baw: Baw;
  ledger: Ledger;
  dryRun: boolean;
  fetch?: typeof fetch;
}): DataPort {
  const guard = ledgerSignatureGuard(deps.ledger);

  return {
    search: (q) =>
      deps.bazaar.search({ query: q.query, maxUsdPrice: q.maxUsdPrice, limit: SEARCH_LIMIT }),

    buy: async (req, maxUsdPerCall) => {
      const outcome = await buy(req, {
        baw: deps.baw,
        dryRun: deps.dryRun,
        maxUsdPerCall,
        alreadySigned: guard.alreadySigned,
        markSigned: guard.markSigned,
        ...(deps.fetch ? { fetch: deps.fetch } : {}),
      });

      // The settlement line belongs next to the signature line, not in whichever
      // caller happens to spend. The guard above writes payment.signed from in
      // here, so writing payment.settled anywhere else leaves a paid call with a
      // claim and no receipt: that is how the prove script spent a live cent and
      // put no settlement hash on the record.
      if (outcome.status === 'paid') {
        deps.ledger.append({
          kind: 'payment.settled',
          actor: 'merchant',
          costUsd: outcome.costUsd,
          ...(outcome.txHash ? { txHash: outcome.txHash } : {}),
          payload: {
            summary: `Paid $${outcome.costUsd.toFixed(4)} to ${req.url}`,
            url: req.url,
            paymentId: outcome.paymentId,
            settlement: outcome.settlement,
          },
        });
      }

      return outcome;
    },
  };
}
