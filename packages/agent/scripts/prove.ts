/**
 * The prove-it command.
 *
 * Seven steps against the real thing: the Binance Agentic Wallet on this
 * machine, the live B402 Bazaar, a live merchant's 402, the exchange Olai
 * booted with, and Olai's own hash-chained ledger. Every step prints PASS,
 * FAIL or SKIP with the reason, so "trust us" becomes "run this".
 *
 * Only step 4 can spend money, and only when .env says OLAI_DRY_RUN=false and
 * OLAI_PROVE_SPEND=yes. Everything else is read only.
 *
 * Run it with: npm run prove -w @olai/agent
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BazaarClient } from '../src/bazaar/client.js';
import { loadConfig } from '../src/config.js';
import type { Ledger } from '../src/ledger/ledger.js';
import { bazaarDataPort } from '../src/ports/data.js';
import type { ExchangePort } from '../src/ports/exchange.js';
import { RulebookStore, defaultRulebook } from '../src/rulebook/store.js';
import { Baw, type X402Option } from '../src/x402/baw.js';
import { nansenCurrentBalance } from '../src/x402/merchants/nansen.js';
import {
  PAYMENT_REQUIRED_HEADER,
  decodePaymentRequired,
} from '../src/x402/paymentRequired.js';

/** A public exchange address, so the merchant always has something to answer with. */
const PROBE_ADDRESS = '0x28c6c06298d514db089934071355e5743bf21d60';

const SEARCH_QUERY = 'wallet balance';
const SEARCH_CAP_USD = 0.05;
const TICKER_SYMBOL = 'BNBUSDT';
const DATA_PREVIEW_CHARS = 200;

let failures = 0;

function line(text = ''): void {
  process.stdout.write(`${text}\n`);
}

function pass(step: number, text: string): void {
  line(`PASS ${step}. ${text}`);
}

function fail(step: number, text: string): void {
  failures += 1;
  line(`FAIL ${step}. ${text}`);
}

function skip(step: number, text: string): void {
  line(`SKIP ${step}. ${text}`);
}

function say(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function money(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? `$${value.toFixed(4)}` : 'unpriced';
}

/** Node 22 and up can read .env itself. Nothing to do if the file is not there. */
function loadEnv(): void {
  const candidates = [fileURLToPath(new URL('../../../.env', import.meta.url)), '.env'];

  for (const path of candidates) {
    if (existsSync(path) && typeof process.loadEnvFile === 'function') {
      process.loadEnvFile(path);
      return;
    }
  }
}

/** Both wallet failures end the same way, so the fix is one sentence in one place. */
const WALLET_NEXT_STEP =
  'Install the Binance Agentic Wallet skill and sign in (npm install -g @binance/agentic-wallet, then baw auth signin). Steps 2 and 5 to 7 do not need it.';

async function proveWallet(baw: Baw): Promise<void> {
  try {
    const status = await baw.walletStatus();
    if (status !== 'CONNECTED') {
      fail(1, `the Binance Agentic Wallet says ${status}. ${WALLET_NEXT_STEP}`);
      return;
    }

    const settings = await baw.walletSettings();
    pass(
      1,
      `wallet CONNECTED, x402 daily limit $${settings.x402DailyLimit}, quota left $${settings.x402QuotaLeft}`,
    );
  } catch (error) {
    fail(1, `could not read the wallet: ${say(error)}. ${WALLET_NEXT_STEP}`);
  }
}

async function proveBazaar(bazaar: BazaarClient): Promise<void> {
  try {
    const found = await bazaar.search({ query: SEARCH_QUERY, maxUsdPrice: SEARCH_CAP_USD });
    const payable = found.filter((resource) => resource.walletPayable);
    const cheapest = payable[0];

    if (!cheapest) {
      fail(2, `the Bazaar had nothing wallet payable for "${SEARCH_QUERY}" under $${SEARCH_CAP_USD}`);
      return;
    }

    pass(
      2,
      `Bazaar has ${payable.length} wallet payable listings for "${SEARCH_QUERY}" under $${SEARCH_CAP_USD}, cheapest ${money(cheapest.priceUsd)} at ${cheapest.url}`,
    );
  } catch (error) {
    fail(2, `the Bazaar search failed: ${say(error)}`);
  }
}

async function provePreview(baw: Baw): Promise<X402Option | null> {
  const request = nansenCurrentBalance({ address: PROBE_ADDRESS, chain: 'ethereum' });

  try {
    const response = await fetch(request.url, {
      method: 'POST',
      headers: { accept: 'application/json', ...request.headers },
      body: JSON.stringify(request.body),
    });
    const text = await response.text();

    if (response.status !== 402) {
      fail(3, `the merchant answered HTTP ${response.status}, not the 402 this step needs`);
      return null;
    }

    const required = decodePaymentRequired(response.headers.get(PAYMENT_REQUIRED_HEADER), text);
    if (!required) {
      fail(3, 'the merchant asked for payment but sent no readable PaymentRequired object');
      return null;
    }

    const preview = await baw.x402Preview(required);
    const top = preview.options[0];
    if (!top) {
      fail(3, `the wallet priced ${preview.paymentId} but offered no payment options at all`);
      return null;
    }

    const reasons = top.reasons.length > 0 ? ` (${top.reasons.join(', ')})` : '';
    pass(
      3,
      `a real 402 previewed to payment ${preview.paymentId} with ${preview.options.length} options, top option is ${top.status}${reasons} for ${money(Number(top.amountUsd))} in ${top.tokenSymbol ?? '?'} on chain ${top.binanceChainId ?? '?'}`,
    );
    return top;
  } catch (error) {
    fail(3, `the 402 preview failed: ${say(error)}`);
    return null;
  }
}

/**
 * Buying through the same data port the agent buys through, rather than calling
 * the buyer directly, is what puts payment.signed and payment.settled on the
 * record as a pair. A direct call leaves the signature claimed and the
 * settlement hash of a real cent nowhere.
 */
async function proveSpend(
  baw: Baw,
  bazaar: BazaarClient,
  ledger: Ledger,
  top: X402Option | null,
  opts: { dryRun: boolean; allowed: boolean; capUsd: number },
): Promise<void> {
  if (opts.dryRun) {
    skip(4, 'OLAI_DRY_RUN is true, so Olai will not sign anything');
    return;
  }
  if (!opts.allowed) {
    skip(4, 'OLAI_PROVE_SPEND is not "yes", so this run will not spend real money');
    return;
  }
  if (!top) {
    skip(4, 'there was no previewed option to pay');
    return;
  }
  if (top.status !== 'READY_TO_SIGN') {
    skip(
      4,
      `the wallet cannot sign the top option, it is ${top.status}${top.reasons.length > 0 ? ` (${top.reasons.join(', ')})` : ''}`,
    );
    return;
  }

  try {
    const data = bazaarDataPort({ bazaar, baw, ledger, dryRun: false });
    const outcome = await data.buy(
      nansenCurrentBalance({ address: PROBE_ADDRESS, chain: 'ethereum' }),
      opts.capUsd,
    );

    if (outcome.status !== 'paid') {
      fail(4, `the paid call ended ${outcome.status}: ${'reason' in outcome ? outcome.reason : ''}`);
      return;
    }

    const body = JSON.stringify(outcome.data).slice(0, DATA_PREVIEW_CHARS);
    pass(
      4,
      `paid ${money(outcome.costUsd)}, settlement ${outcome.txHash ?? 'no hash returned'}, data starts: ${body}`,
    );
  } catch (error) {
    fail(4, `the paid call threw: ${say(error)}`);
  }
}

async function proveExchange(exchange: ExchangePort): Promise<void> {
  try {
    const ticker = await exchange.ticker(TICKER_SYMBOL);

    if (exchange.name === 'fake') {
      pass(
        5,
        `fake exchange, MCP not connected: ${TICKER_SYMBOL} reads ${ticker.price} from made-up data, not from Binance`,
      );
      return;
    }

    pass(5, `${exchange.name} priced ${TICKER_SYMBOL} at ${ticker.price}`);
  } catch (error) {
    fail(5, `the exchange would not quote ${TICKER_SYMBOL}: ${say(error)}`);
  }
}

function proveChain(ledger: Ledger): void {
  const chain = ledger.verifyChain();
  if (chain.ok) {
    pass(6, `the ledger hash chain holds across all ${chain.length} lines`);
    return;
  }
  fail(6, `the ledger chain broke at line ${chain.brokenAtSeq}: ${chain.reason}`);
}

function proveSpendSummary(ledger: Ledger, afterSeq: number): void {
  const settled = ledger.list({ afterSeq, kinds: ['payment.settled'] });
  const claimed = ledger.list({ afterSeq, kinds: ['payment.signed'] });
  const spent = settled.reduce((total, entry) => total + (entry.costUsd ?? 0), 0);

  pass(
    7,
    `this run spent ${money(spent)} across ${settled.length} settled payments (${claimed.length} signatures claimed)`,
  );
}

async function main(): Promise<number> {
  loadEnv();
  process.env['OLAI_LOG_LEVEL'] ??= 'warn';

  const config = loadConfig(process.env);

  // Loaded here rather than at the top of the file so that the log level set
  // above is already in place when the service builds its logger.
  const { buildService } = await import('../src/boot.js');
  const service = await buildService(config);
  const baw = new Baw();

  try {
    const rulebook =
      new RulebookStore({ path: config.OLAI_RULEBOOK_PATH, ledger: service.ledger }).load() ??
      defaultRulebook;
    const startSeq = service.ledger.latest()?.seq ?? 0;

    line(
      `Olai: ${config.OLAI_DRY_RUN ? 'dry run' : 'LIVE'}, exchange ${service.exchange.name}, cap ${money(rulebook.maxDataSpendUsdPerCall)} a call, ${money(rulebook.maxDataSpendUsdPerDay)} a day`,
    );
    line();

    const bazaar = new BazaarClient({ baseUrl: config.BAZAAR_BASE_URL });

    await proveWallet(baw);
    await proveBazaar(bazaar);
    const top = await provePreview(baw);
    await proveSpend(baw, bazaar, service.ledger, top, {
      dryRun: config.OLAI_DRY_RUN,
      allowed: process.env['OLAI_PROVE_SPEND'] === 'yes',
      capUsd: rulebook.maxDataSpendUsdPerCall,
    });
    await proveExchange(service.exchange);
    proveChain(service.ledger);
    proveSpendSummary(service.ledger, startSeq);

    line();
    line(failures === 0 ? 'Every step that ran, passed.' : `${failures} step(s) failed.`);

    return failures === 0 ? 0 : 1;
  } finally {
    await service.close();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    line(`The proof run stopped before it finished: ${say(error)}`);
    process.exitCode = 1;
  });
