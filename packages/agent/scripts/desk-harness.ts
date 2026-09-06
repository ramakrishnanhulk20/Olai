import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { buildService } from '../src/boot.js';
import { loadConfig } from '../src/config.js';
import { defaultRulebook } from '../src/rulebook/store.js';
import { Baw } from '../src/x402/baw.js';
import { type ScriptedTurn, fakeAnthropic } from '../attacks/fake-anthropic.js';

/**
 * A throwaway copy of Olai for a UI walk, on port 4100.
 *
 * Nothing in here touches the owner's real service, the real wallet or the real
 * exchange: the brain is scripted, the exchange is the deterministic fake, the
 * Bazaar and the merchant are answered in this file, and the ledger is a new
 * SQLite file under the OS temp directory. It exists so a browser can be driven
 * through every desk state without spending a cent.
 *
 * Known gap against the work order it was written for: the order asked for dry
 * run OFF with the fake exchange. boot.ts refuses that pairing on purpose (see
 * pickExchange: the fake exchange is only allowed in a dry run), and buildService
 * takes no exchange or data port argument, so this runs with dry run ON. What
 * changes on screen: the status chip reads "Dry run" rather than "Live", an
 * approved order ends with "Dry run, not sent to Binance" instead of a fill, and
 * the ledger gets payment.preview lines rather than payment.settled lines with a
 * settlement hash.
 */

/** Not a secret. It only ever opens this throwaway service on port 4100. */
const OWNER_TOKEN = 'ol.desk-harness-token-not-for-production-1';

const PORT = 4100;
const WEB_ORIGIN = 'http://localhost:3002';

const BAZAAR_BASE_URL = 'https://bazaar.desk-harness.invalid/b402';
const MERCHANT_URL = 'https://data.desk-harness.invalid/x402/bnb-wallet-flows';

/** One cent of an 18 decimal BSC stablecoin, the shape the Bazaar lists prices in. */
const ONE_CENT_BASE_UNITS = '10000000000000000';
const BSC_USDT = '0x55d398326f99059ff775485246999027b3197955';

/**
 * A session has to last long enough for a person, and a screenshot, to catch the
 * wait label and the thinking feed. The two outside calls are slowed on purpose.
 */
const SEARCH_DELAY_MS = 3200;
const MERCHANT_DELAY_MS = 3200;

const SETTLEMENT_TX = '0x7d1f4c0b9a2e5f3c8d6b1a4907e2c5f8b3d0a6194c7e2f5b8a1d4c7e0b3f6a921';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

const bazaarAnswer = {
  code: '000000',
  message: null,
  success: true,
  data: {
    resources: [
      {
        resource: MERCHANT_URL,
        type: 'http',
        x402Version: 2,
        description: 'BNB wallet flows over the last 24 hours, smart money net position by cohort.',
        accepts: [
          {
            scheme: 'permit2-exact',
            network: 'eip155:56',
            asset: BSC_USDT,
            maxAmountRequired: ONE_CENT_BASE_UNITS,
            payTo: '0x4f3a2b1c9d8e7f60514233a2b1c0d9e8f7a6b5c4',
          },
        ],
        lastUpdated: 1_757_116_800_000,
      },
    ],
  },
};

const paymentRequired = {
  x402Version: 2,
  error: 'payment required',
  accepts: [
    {
      scheme: 'exact',
      network: 'eip155:56',
      asset: BSC_USDT,
      payTo: '0x4f3a2b1c9d8e7f60514233a2b1c0d9e8f7a6b5c4',
      maxAmountRequired: ONE_CENT_BASE_UNITS,
      extra: { assetTransferMethod: 'permit2-exact' },
    },
  ],
};

/** Answers the two addresses the walk needs and refuses everything else. */
const harnessFetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const url = String(input);

  if (url.startsWith(`${BAZAAR_BASE_URL}/bazaar/search`)) {
    await sleep(SEARCH_DELAY_MS);
    return json(bazaarAnswer);
  }

  if (url.startsWith(MERCHANT_URL)) {
    await sleep(MERCHANT_DELAY_MS);
    return json(paymentRequired, 402, {
      'payment-required': Buffer.from(JSON.stringify(paymentRequired), 'utf8').toString('base64'),
    });
  }

  return json({ error: `the desk harness blocked an outbound call to ${url}` }, 502);
}) as typeof fetch;

/** The wallet, answered from this file. The real CLI is never called. */
function harnessBaw(): Baw {
  return new Baw({
    run: async (args) => {
      const data = walletAnswer(args);
      return { stdout: JSON.stringify({ success: true, data }), exitCode: 0 };
    },
  });
}

function walletAnswer(args: string[]): unknown {
  if (args[0] === 'wallet' && args[1] === 'status') {
    return { status: 'CONNECTED' };
  }
  if (args[0] === 'wallet' && args[1] === 'settings') {
    return {
      x402DailyLimit: 5,
      x402QuotaUsed: 0.42,
      x402QuotaLeft: 4.58,
      dailyLimit: 50,
      abnormalTxnHandling: 'BLOCK',
    };
  }
  if (args[0] === 'wallet' && args[1] === 'balance') {
    return [
      {
        binanceChainId: '56',
        tokenSymbol: 'USDT',
        tokenAddress: BSC_USDT,
        balance: '4.812',
        balanceUsd: '4.81',
      },
    ];
  }
  if (args[0] === 'x402-payment' && args[1] === 'preview') {
    return {
      paymentId: `pay_${Math.random().toString(36).slice(2, 10)}`,
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
          payTo: '0x4f3a2b1c9d8e7f60514233a2b1c0d9e8f7a6b5c4',
          needApproveFirst: false,
        },
      ],
    };
  }
  return {};
}

/** One question, start to finish: search the Bazaar, buy one feed, propose a 12 dollar buy. */
const script: ScriptedTurn[] = [
  {
    thinking:
      'The owner is asking about BNB. Start with what the market is doing, then find one paid feed worth a cent.',
    toolCalls: [{ name: 'search_bazaar', input: { query: 'BNB wallet flows', maxUsdPrice: 0.05 } }],
  },
  {
    thinking: 'One payable listing at a cent. That is inside the per-call budget, so buy it.',
    toolCalls: [{ name: 'buy_data', input: { url: MERCHANT_URL, method: 'GET' } }],
  },
  {
    text: 'Flows turned positive two days ago and the book is thick on the bid. A small add, not a swing.',
    toolCalls: [
      {
        name: 'propose',
        input: {
          summary: 'Add 12 dollars of BNB while smart money is still accumulating.',
          reasoning:
            'Wallet flows show net accumulation by the cohort that led the last two moves, and the top of the book is thick enough that a 12 dollar market order pays almost no spread. The size is well inside the rulebook, so this is an add rather than a position change.',
          action: {
            type: 'order',
            symbol: 'BNBUSDT',
            side: 'BUY',
            quoteUsd: 12,
            orderType: 'MARKET',
          },
          confidence: 0.62,
          dataUsed: [{ url: MERCHANT_URL, costUsd: 0.01, txHash: SETTLEMENT_TX }],
          risks: [
            'Flow data lags the tape by about an hour, so a reversal inside that window is invisible here.',
            'One feed answered this question. A second source would cost another cent and has not been bought.',
          ],
        },
      },
    ],
  },
];

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'olai-desk-harness-'));
  const rulebookPath = join(dir, 'rulebook.json');

  // The fake exchange holds 1531 dollars of BNB, which the starter rulebook's 50
  // dollar position cap would refuse on its own, and the 60 second cool-down
  // would refuse the second question of the walk. Both are widened here so the
  // walk reaches the screens it is meant to photograph.
  writeFileSync(
    rulebookPath,
    JSON.stringify(
      {
        ...defaultRulebook,
        name: 'Desk harness rulebook',
        maxPositionUsdPerSymbol: 5000,
        cooldownSecondsBetweenOrders: 0,
      },
      null,
      2,
    ),
    'utf8',
  );

  const config = loadConfig({
    ANTHROPIC_API_KEY: 'the-desk-harness-uses-a-scripted-model-instead',
    OLAI_OWNER_TOKEN: OWNER_TOKEN,
    OLAI_DB_PATH: join(dir, 'olai.db'),
    OLAI_RULEBOOK_PATH: rulebookPath,
    OLAI_TOKEN_PATH: join(dir, 'binance-mcp-token.json'),
    OLAI_DRY_RUN: 'true',
    OLAI_EXCHANGE: 'fake',
    OLAI_WEB_ORIGIN: WEB_ORIGIN,
    OLAI_PUBLIC_BASE_URL: 'https://olai-desk-harness.invalid',
    BAZAAR_BASE_URL,
  });

  const service = await buildService(config, {
    baw: harnessBaw(),
    anthropic: fakeAnthropic(Array.from({ length: 200 }, () => script)).client,
    fetch: harnessFetch,
  });

  serve({ fetch: service.app.fetch, hostname: '127.0.0.1', port: PORT }, (info) => {
    process.stdout.write(
      [
        '',
        'Desk harness up. Nothing here is real.',
        `  url     http://localhost:${info.port}`,
        `  token   ${OWNER_TOKEN}`,
        `  ledger  ${join(dir, 'olai.db')}`,
        `  web     ${WEB_ORIGIN}`,
        '',
      ].join('\n'),
    );
  });
}

await main();
