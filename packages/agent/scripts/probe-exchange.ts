/**
 * Proves Olai's exchange leg against the real Binance Spot REST API.
 *
 * It reads the same three market endpoints from both the spot testnet and the
 * production API, so the numbers on screen come from Binance and nowhere else.
 * The signed calls (the account and its positions) need a key, so they are
 * skipped with a reason when there is none. Nothing here places an order.
 *
 * Run it with: npm run probe:exchange -w @olai/agent
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BinanceRestExchange } from '../src/exchange/rest.js';

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
loadEnv();

const NETWORKS: Array<{ label: string; baseUrl: string }> = [
  { label: 'testnet', baseUrl: 'https://testnet.binance.vision' },
  { label: 'production', baseUrl: 'https://api.binance.com' },
];

const SYMBOL = 'BNBUSDT';

function line(text = ''): void {
  process.stdout.write(`${text}\n`);
}

function money(value: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

async function readMarket(label: string, baseUrl: string): Promise<void> {
  // The market endpoints are public, so the key and secret are empty on purpose:
  // an unsigned read must work without either.
  const exchange = new BinanceRestExchange({
    baseUrl,
    apiKey: process.env.BINANCE_API_KEY ?? '',
    apiSecret: process.env.BINANCE_API_SECRET ?? '',
  });

  line(`${label}: ${exchange.name} at ${baseUrl}`);

  const ticker = await exchange.ticker(SYMBOL);
  line(
    `  ticker ${ticker.symbol} ${money(ticker.price)} USDT, ${ticker.change24hPct}% over 24h, ` +
      `high ${money(ticker.high24h)}, low ${money(ticker.low24h)}, quote volume ${money(ticker.volume24hQuote)}`,
  );
  line(`  as of ${ticker.asOf}`);

  const book = await exchange.orderBook(SYMBOL, 3);
  line(`  book top bid ${book.bids[0]?.[0]} for ${book.bids[0]?.[1]}, top ask ${book.asks[0]?.[0]} for ${book.asks[0]?.[1]}`);
  line(`  spread ${((book.asks[0]?.[0] ?? 0) - (book.bids[0]?.[0] ?? 0)).toFixed(4)} USDT`);

  const candles = await exchange.klines(SYMBOL, '1h', 3);
  for (const candle of candles) {
    line(`  kline ${candle.t}  o ${candle.o}  h ${candle.h}  l ${candle.l}  c ${candle.c}  v ${candle.v}`);
  }

  await readAccount(exchange, label);
  line();
}

async function readAccount(exchange: BinanceRestExchange, label: string): Promise<void> {
  const key = process.env.BINANCE_API_KEY;
  const secret = process.env.BINANCE_API_SECRET;

  if (!key || !secret) {
    line(`  SKIP signed calls on ${label}: BINANCE_API_KEY and BINANCE_API_SECRET are not set`);
    return;
  }

  const env = process.env.BINANCE_API_ENV ?? 'testnet';
  const meantFor = env === 'prod' ? 'production' : 'testnet';
  if (meantFor !== label) {
    line(`  SKIP signed calls on ${label}: the key in .env is a ${meantFor} key (BINANCE_API_ENV=${env})`);
    return;
  }

  const held = await exchange.balances();
  const worth = held.filter((row) => (row.usdValue ?? 0) > 0);
  line(`  account: ${held.length} assets, ${worth.length} with a value`);
  for (const row of worth.slice(0, 5)) {
    line(`    ${row.asset} free ${row.free} locked ${row.locked} worth ${row.usdValue === null ? 'unpriced' : money(row.usdValue)} USD`);
  }

  const positions = await exchange.positions();
  line(`  positions above 1 USD: ${positions.length}`);
  for (const position of positions.slice(0, 5)) {
    line(`    ${position.symbol} ${position.side} ${position.qty} worth ${money(position.usd)} USD`);
  }
}

async function main(): Promise<void> {
  for (const network of NETWORKS) {
    await readMarket(network.label, network.baseUrl);
  }

  line('No order was sent. Every number above came from Binance.');
}

main().catch((error: unknown) => {
  line(`probe failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
