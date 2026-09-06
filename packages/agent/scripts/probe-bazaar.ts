/**
 * Proves the buying side against the real thing: the live B402 Bazaar, two live
 * merchants, and the real Binance Agentic Wallet on this machine.
 *
 * It runs in dry run, so it stops before any signature and no money can move. The
 * only wallet commands it uses are read only: status, settings, and x402 preview.
 *
 * Run it with: npm run probe:bazaar -w @olai/agent
 */

import { BazaarClient, type BazaarResource } from '../src/bazaar/client.js';
import { memorySignatureGuard } from '../src/ports/data.js';
import { Baw } from '../src/x402/baw.js';
import { buy, type BuyOutcome, type BuyRequest } from '../src/x402/buyer.js';
import { cmcQuotesLatest } from '../src/x402/merchants/cmc.js';
import { nansenCurrentBalance } from '../src/x402/merchants/nansen.js';
import {
  PAYMENT_REQUIRED_HEADER,
  decodePaymentRequired,
} from '../src/x402/paymentRequired.js';

const BAZAAR_BASE_URL =
  process.env.BAZAAR_BASE_URL ?? 'https://www.binance.com/bapi/ramp/v1/public/ramp/b402';

const MAX_USD_PER_CALL = 0.05;

function line(text = ''): void {
  process.stdout.write(`${text}\n`);
}

function money(value: number | null): string {
  return value === null ? 'unpriced' : `$${value.toFixed(4)}`;
}

function printResources(title: string, resources: BazaarResource[]): void {
  line(`${title}: ${resources.length} wallet payable under ${money(MAX_USD_PER_CALL)}`);
  for (const resource of resources) {
    const chains = [...new Set(resource.accepts.map((accept) => accept.network))].join(', ');
    line(`  ${money(resource.priceUsd)}  ${resource.url}`);
    line(`         chains: ${chains}`);
  }
}

async function showLivePreview(baw: Baw, label: string, req: BuyRequest): Promise<void> {
  const method = req.method ?? 'GET';
  const response = await fetch(req.url, {
    method,
    headers: { accept: 'application/json', ...req.headers },
    ...(method === 'POST' && req.body !== undefined
      ? { body: JSON.stringify(req.body) }
      : {}),
  });
  const text = await response.text();

  line(`${label}: HTTP ${response.status} from ${req.url}`);

  const paymentRequired = decodePaymentRequired(
    response.headers.get(PAYMENT_REQUIRED_HEADER),
    text,
  );
  if (!paymentRequired) {
    line('  no PaymentRequired object, nothing to preview');
    return;
  }

  line(
    `  x402 version ${paymentRequired.x402Version}, ${paymentRequired.accepts.length} payment options offered`,
  );

  const preview = await baw.x402Preview(paymentRequired);
  line(`  wallet preview ${preview.paymentId}, ${preview.options.length} options ranked`);

  for (const option of preview.options.slice(0, 3)) {
    const reasons = option.reasons.length > 0 ? ` (${option.reasons.join(', ')})` : '';
    line(
      `    ${option.index}. ${option.status}${reasons} ${option.tokenSymbol ?? '?'} on chain ${option.binanceChainId ?? '?'} for ${option.amountUsd ?? '?'} USD`,
    );
  }

  const chosen = preview.options[0];
  line(`  chosen: option ${chosen?.index ?? 0} ${chosen?.status ?? 'none'}`);
}

function describeOutcome(outcome: BuyOutcome): string {
  switch (outcome.status) {
    case 'paid':
      return `paid ${money(outcome.costUsd)}, tx ${outcome.txHash ?? 'unknown'}`;
    case 'dry-run':
      return `would pay ${money(outcome.costUsd)} on chain ${outcome.option.binanceChainId ?? '?'}, stopped before signing`;
    case 'free':
      return 'endpoint was free';
    case 'refused':
      return `refused: ${outcome.reason} (${money(outcome.costUsd)})`;
    case 'failed':
      return `failed: ${outcome.reason}`;
  }
}

async function main(): Promise<void> {
  const bazaar = new BazaarClient({ baseUrl: BAZAAR_BASE_URL });
  const baw = new Baw();

  const status = await baw.walletStatus();
  const settings = await baw.walletSettings();
  line(`wallet ${status}, x402 quota left ${settings.x402QuotaLeft} of ${settings.x402DailyLimit}`);
  line(`balance entries: ${(await baw.walletBalance()).length}`);
  line();

  const catalog = await bazaar.list({ limit: 3 });
  line(`Bazaar catalog: ${catalog.total} listings, newest ${catalog.items[0]?.url ?? 'none'}`);
  line();

  for (const query of ['wallet balance', 'quotes']) {
    const found = await bazaar.search({ query, maxUsdPrice: MAX_USD_PER_CALL, limit: 5 });
    printResources(`search "${query}"`, found.filter((resource) => resource.walletPayable));
    line();
  }

  const targets: Array<[string, BuyRequest]> = [
    [
      'Nansen current balance',
      nansenCurrentBalance({
        address: '0x28c6c06298d514db089934071355e5743bf21d60',
        chain: 'ethereum',
      }),
    ],
    ['CoinMarketCap quotes', cmcQuotesLatest({ symbol: 'BNB' })],
  ];

  for (const [label, req] of targets) {
    await showLivePreview(baw, label, req);
    const outcome = await buy(req, {
      dryRun: true,
      maxUsdPerCall: MAX_USD_PER_CALL,
      baw,
      // This probe never reaches a signature, but the buyer asks for the guard
      // whatever the mode, and a probe has no ledger of its own to write to.
      ...memorySignatureGuard(),
    });
    line(`  buy(dryRun): ${describeOutcome(outcome)}`);
    line();
  }

  line('Nothing was signed. No money moved.');
  line(
    'An empty wallet makes every option ACTION_REQUIRED with INSUFFICIENT_BALANCE, which is the expected live result today.',
  );
}

main().catch((error: unknown) => {
  line(`probe failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
