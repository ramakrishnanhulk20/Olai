import Anthropic from '@anthropic-ai/sdk';
import { Hono } from 'hono';
import { pino } from 'pino';
import { AccountStateSource } from './account/state.js';
import { createApp } from './api/app.js';
import { ownerAuth } from './api/auth.js';
import { EventHub } from './api/events.js';
import { BazaarClient } from './bazaar/client.js';
import type { Config } from './config.js';
import { BinanceRestExchange } from './exchange/rest.js';
import { Ledger } from './ledger/ledger.js';
import { BinanceMcp } from './mcp/client.js';
import { McpExchange } from './mcp/exchange.js';
import { BinanceOAuth, oauthRoutes } from './mcp/oauth.js';
import { resolveToolMap } from './mcp/toolmap.js';
import { bazaarDataPort } from './ports/data.js';
import type { ExchangePort } from './ports/exchange.js';
import { FakeExchange } from './ports/fake.js';
import { RulebookStore, defaultRulebook } from './rulebook/store.js';
import { SessionRunner } from './session/session.js';
import { Baw } from './x402/baw.js';

/**
 * Where the parts become one running agent.
 *
 * Every piece of Olai takes its dependencies as arguments, which keeps them
 * testable but leaves somebody to do the plugging in. This is that somebody, and
 * it is also the last gate: a service that cannot be built safely is never
 * built at all, so the process stops here rather than halfway through a trade.
 */

export const log = pino({
  name: 'olai',
  level: process.env['OLAI_LOG_LEVEL'] ?? (process.env['VITEST'] ? 'silent' : 'info'),
});

/** Olai will not start in this state, and the message says what to change. */
export class BootError extends Error {
  override name = 'BootError';
}

export interface Service {
  app: Hono;
  runner: SessionRunner;
  ledger: Ledger;
  exchange: ExchangePort;
  close(): Promise<void>;
}

export interface BootDeps {
  fetch?: typeof fetch;
  now?: () => number;
  /**
   * The wallet CLI wrapper. Injected only by tests, which must never shell out
   * to the real wallet on the machine, not even for a read.
   */
  baw?: Baw;
  /** The brain. Injected only by tests, which script it instead of paying for it. */
  anthropic?: Anthropic;
}

export async function buildService(config: Config, deps: BootDeps = {}): Promise<Service> {
  const now = deps.now ?? Date.now;
  const ledger = new Ledger(config.OLAI_DB_PATH);
  const events = new EventHub();
  publishEveryLine(ledger, events);

  const oauth = new BinanceOAuth(
    {
      mcpUrl: config.BINANCE_MCP_URL,
      publicBaseUrl: config.OLAI_PUBLIC_BASE_URL,
      tokenPath: config.OLAI_TOKEN_PATH,
      clientName: config.OLAI_CLIENT_NAME,
    },
    {
      ...(deps.fetch ? { fetch: deps.fetch } : {}),
      ...(deps.now ? { now: deps.now } : {}),
    },
  );

  const mcp = new BinanceMcp({
    mcpUrl: config.BINANCE_MCP_URL,
    oauth,
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
  });

  try {
    const rulebooks = new RulebookStore({ path: config.OLAI_RULEBOOK_PATH, ledger });
    if (rulebooks.load() === null) {
      // A first run has no rulebook file. Writing the defaults through the store
      // rather than holding them in memory means the very first line of the
      // ledger says which rules Olai started under.
      rulebooks.save(defaultRulebook, 'system');
    }

    const exchange = await pickExchange(config, oauth, mcp, deps);
    const baw = deps.baw ?? new Baw();
    const bazaar = new BazaarClient({
      baseUrl: config.BAZAAR_BASE_URL,
      ...(deps.fetch ? { fetch: deps.fetch } : {}),
    });

    const account = new AccountStateSource({
      exchange,
      ledger,
      now: () => new Date(now()),
    });

    const runner = new SessionRunner({
      exchange,
      data: bazaarDataPort({
        bazaar,
        baw,
        ledger,
        dryRun: config.OLAI_DRY_RUN,
        ...(deps.fetch ? { fetch: deps.fetch } : {}),
      }),
      ledger,
      // Read again at every use, so an edit through PUT /api/rulebook governs
      // the next question and the next approval without a restart.
      rulebook: () => rulebooks.load() ?? defaultRulebook,
      anthropic: deps.anthropic ?? new Anthropic({ apiKey: config.ANTHROPIC_API_KEY }),
      dryRun: config.OLAI_DRY_RUN,
      accountState: () => account.snapshot(),
      onEvent: (sessionId, event) =>
        events.publish({
          type: event.type,
          sessionId,
          at: new Date(now()).toISOString(),
          data: event,
        }),
    });

    const app = new Hono();
    // The metadata document and the callback must stay public (Binance fetches one
    // and redirects to the other), but starting, inspecting or dropping the Binance
    // session is the owner's business, so those three sit behind the owner token.
    for (const path of ['/oauth/start', '/oauth/status', '/oauth/disconnect']) {
      app.use(path, ownerAuth({ token: config.OLAI_OWNER_TOKEN, trustProxy: config.OLAI_TRUST_PROXY }));
    }
    app.route('/', oauthRoutes(oauth));
    app.route(
      '/',
      createApp({
        runner,
        ledger,
        rulebooks,
        account,
        baw,
        bazaar,
        events,
        ownerToken: config.OLAI_OWNER_TOKEN,
        dryRun: config.OLAI_DRY_RUN,
        trustProxy: config.OLAI_TRUST_PROXY,
        webOrigin: config.OLAI_WEB_ORIGIN,
      }),
    );

    await announce(config, exchange, baw);

    let closed = false;
    return {
      app,
      runner,
      ledger,
      exchange,
      close: async () => {
        if (closed) {
          return;
        }
        closed = true;
        await mcp.close();
        ledger.close();
      },
    };
  } catch (error) {
    // A boot that failed halfway must not leave the database file open or an
    // MCP session hanging, or the next attempt fights the last one.
    await mcp.close().catch(() => {});
    ledger.close();
    throw error;
  }
}

/**
 * Which exchange Olai trades through.
 *
 * auto takes the first real door that is open: an API key on the Spot REST API,
 * then a saved Binance sign-in for the MCP server, then the fake one. The key
 * comes first because Binance's MCP consent screen only admits its own
 * allowlisted agents today, so a machine with both is still better off on REST.
 * The fake exchange is only ever allowed in a dry run, because an agent that
 * reports made-up prices as if they were the market is worse than an agent that
 * will not start.
 */
async function pickExchange(
  config: Config,
  oauth: BinanceOAuth,
  mcp: BinanceMcp,
  deps: BootDeps,
): Promise<ExchangePort> {
  const wanted = config.OLAI_EXCHANGE;
  const apiKey = config.BINANCE_API_KEY;
  const apiSecret = config.BINANCE_API_SECRET;

  if (wanted === 'rest' || (wanted === 'auto' && apiKey !== undefined && apiSecret !== undefined)) {
    if (apiKey === undefined || apiSecret === undefined) {
      throw new BootError(
        'OLAI_EXCHANGE=rest needs both BINANCE_API_KEY and BINANCE_API_SECRET in .env. ' +
          'Generate a testnet key at https://testnet.binance.vision, or a trade-only key on a Binance sub-account.',
      );
    }

    return new BinanceRestExchange({
      baseUrl:
        config.BINANCE_API_ENV === 'prod' ? 'https://api.binance.com' : 'https://testnet.binance.vision',
      apiKey,
      apiSecret,
      ...(deps.fetch ? { fetch: deps.fetch } : {}),
      ...(deps.now ? { now: deps.now } : {}),
    });
  }

  const useMcp =
    wanted === 'mcp' || (wanted === 'auto' && (await oauth.currentToken()) !== null);

  if (useMcp) {
    try {
      await mcp.connect();
      return new McpExchange(mcp, resolveToolMap(await mcp.listTools()));
    } catch (error) {
      throw new BootError(`Olai could not open the Binance MCP session: ${say(error)}`);
    }
  }

  if (!config.OLAI_DRY_RUN) {
    throw new BootError(
      'live mode needs a connected Binance exchange (REST key or MCP session). ' +
        'Put BINANCE_API_KEY and BINANCE_API_SECRET in .env, or open ' +
        `${config.OLAI_PUBLIC_BASE_URL}/oauth/start in a browser signed in to Binance, ` +
        'or set OLAI_DRY_RUN=true to run without either.',
    );
  }

  return new FakeExchange();
}

/**
 * The ledger is the durable record and the event feed is the live one. Tapping
 * append here means every line the agent writes reaches the dashboard, whichever
 * part of Olai wrote it, without every one of those parts knowing about events.
 */
function publishEveryLine(ledger: Ledger, events: EventHub): void {
  const append = ledger.append.bind(ledger);

  ledger.append = (input) => {
    const entry = append(input);
    events.publish({ type: 'ledger', at: entry.ts, data: entry });
    return entry;
  };
}

/** One line that says what Ram is actually running, before anything else happens. */
async function announce(config: Config, exchange: ExchangePort, baw: Baw): Promise<void> {
  const mode = config.OLAI_DRY_RUN ? 'dry run, nothing is sent' : 'live, approved orders are real';
  // The environment only means something for the REST door. Printing it next to
  // the fake exchange would suggest a connection that is not there.
  const venue = exchange.name.startsWith('binance-spot')
    ? `${exchange.name} on ${config.BINANCE_API_ENV}`
    : exchange.name;

  log.info(
    {
      mode,
      exchange: exchange.name,
      apiEnv: config.BINANCE_API_ENV,
      wallet: await walletStatus(baw),
      publicBaseUrl: config.OLAI_PUBLIC_BASE_URL,
    },
    `Olai is wired up: ${mode}, exchange ${venue}`,
  );

  if (!config.OLAI_PUBLIC_BASE_URL.startsWith('https://')) {
    log.warn(
      { publicBaseUrl: config.OLAI_PUBLIC_BASE_URL },
      'OLAI_PUBLIC_BASE_URL is not an https address, so Binance cannot fetch Olai during sign-in. Run a tunnel and put its address in .env.',
    );
  }
}

/** A wallet Olai cannot reach is a fact for the log, not a reason to stop. */
async function walletStatus(baw: Baw): Promise<string> {
  try {
    return await baw.walletStatus();
  } catch {
    return 'unavailable';
  }
}

function say(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
