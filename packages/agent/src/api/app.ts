import { type Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import type { AccountStateSource } from '../account/state.js';
import type { BazaarClient } from '../bazaar/client.js';
import type { Ledger } from '../ledger/ledger.js';
import { type LedgerKind, ledgerKinds } from '../ledger/types.js';
import { type RulebookStore, defaultRulebook } from '../rulebook/store.js';
import type { SessionRunner } from '../session/session.js';
import type { Baw } from '../x402/baw.js';
import { assertOwnerToken, clientIp, ownerAuth, rateLimit } from './auth.js';
import { ApiError, toFailure } from './errors.js';
import type { EventHub } from './events.js';
import { log } from './log.js';

/**
 * The owner's API.
 *
 * Everything the dashboard and the demo do goes through here: write the
 * rulebook, ask a question, watch the thinking, approve or reject, stop the
 * agent, read the ledger back and check that it has not been touched.
 *
 * There is one user. Every route under /api needs the owner's token, and the
 * agent itself is never a caller: nothing in this file can start an order that
 * the owner did not approve.
 */

export interface AppDeps {
  runner: SessionRunner;
  ledger: Ledger;
  rulebooks: RulebookStore;
  account: AccountStateSource;
  baw?: Baw;
  bazaar?: BazaarClient;
  ownerToken: string;
  dryRun: boolean;
  events: EventHub;
  /** Only set this when a proxy in front of the agent rewrites X-Forwarded-For. */
  trustProxy?: boolean;
  /** The one browser origin allowed to call this API. */
  webOrigin?: string;
  version?: string;
}

const MAX_BODY_BYTES = 64 * 1024;
const HEARTBEAT_MS = 15_000;

/** One dashboard, a couple of tabs, a demo screen. Past that something is wrong. */
const MAX_EVENT_STREAMS = 16;

const DEFAULT_VERSION = '0.1.0';

const DEFAULT_WEB_ORIGIN = 'http://localhost:3000';

const askSchema = z.object({
  question: z.string().trim().min(1, 'ask Olai something').max(2000),
});

const rejectSchema = z.object({
  reason: z.string().trim().min(1).max(500).default('The owner gave no reason.'),
});

const ledgerQuerySchema = z.object({
  afterSeq: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  kinds: z.string().max(400).optional(),
  sessionId: z.string().min(1).max(256).optional(),
});

const searchQuerySchema = z.object({
  query: z.string().trim().min(1, 'say what to search for').max(200),
  maxUsdPrice: z.coerce.number().positive().max(1000).optional(),
});

const knownKinds = new Set<string>(ledgerKinds);

export function createApp(deps: AppDeps): Hono {
  assertOwnerToken(deps.ownerToken);

  const trustProxy = deps.trustProxy ?? false;
  const version = deps.version ?? DEFAULT_VERSION;
  const app = new Hono();

  /**
   * One origin, and it is named. The owner's token sits in the dashboard, so a
   * page on any other site that talked the browser into calling this API would
   * be spending the owner's money. This runs before the token is even looked at,
   * because a browser has to be told no on the preflight, not on the request.
   */
  const allowBrowser = cors({
    origin: deps.webOrigin ?? DEFAULT_WEB_ORIGIN,
    allowMethods: ['GET', 'POST', 'PUT', 'OPTIONS'],
    allowHeaders: ['Authorization', 'Content-Type'],
  });

  app.use('/health', allowBrowser);
  app.use('/api/*', allowBrowser);

  app.use('/api/*', rateLimit({ trustProxy }));
  app.use('/api/*', ownerAuth({ token: deps.ownerToken, trustProxy }));
  app.use(
    '/api/*',
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) => c.json({ error: 'that request body is too big for this API' }, 413),
    }),
  );

  app.get('/health', (c) =>
    c.json({ ok: true, dryRun: deps.dryRun, killed: deps.runner.isKilled, version }),
  );

  app.get('/api/rulebook', (c) => c.json(deps.rulebooks.load() ?? defaultRulebook));

  app.put('/api/rulebook', async (c) => {
    const body = await readJson(c);
    return c.json(deps.rulebooks.save(body, 'owner'));
  });

  app.post('/api/ask', async (c) => {
    const { question } = parse(askSchema, await readJson(c));
    return c.json(await deps.runner.ask(question));
  });

  app.get('/api/sessions', (c) => c.json(deps.runner.list()));

  app.get('/api/sessions/:id', (c) => {
    const record = deps.runner.get(sessionId(c));
    if (!record) {
      throw new ApiError(404, 'there is no session with that id');
    }
    return c.json(record);
  });

  app.post('/api/sessions/:id/approve', async (c) =>
    c.json(await deps.runner.approve(sessionId(c))),
  );

  app.post('/api/sessions/:id/reject', async (c) => {
    const { reason } = parse(rejectSchema, await readJson(c));
    return c.json(await deps.runner.reject(sessionId(c), reason));
  });

  app.post('/api/kill', (c) => {
    deps.runner.kill();
    return c.json({ killed: true });
  });

  app.post('/api/resume', (c) => {
    deps.runner.resume();
    return c.json({ killed: false });
  });

  app.get('/api/ledger', (c) => {
    const query = parse(ledgerQuerySchema, c.req.query());
    const kinds = readKinds(query.kinds);

    const entries = deps.ledger.list({
      ...(query.afterSeq === undefined ? {} : { afterSeq: query.afterSeq }),
      ...(query.sessionId === undefined ? {} : { sessionId: query.sessionId }),
      ...(kinds === undefined ? {} : { kinds }),
      limit: query.limit,
    });

    const last = entries[entries.length - 1];
    return c.json({
      entries,
      // What to send as afterSeq to get the next page. Null means this is the end.
      nextAfterSeq: entries.length === query.limit && last ? last.seq : null,
    });
  });

  app.get('/api/ledger/verify', (c) => c.json(deps.ledger.verifyChain()));

  app.get('/api/account', async (c) => c.json(await deps.account.snapshot()));

  app.get('/api/wallet', async (c) => {
    const baw = deps.baw;
    if (!baw) {
      return c.json({ status: 'unavailable', settings: null, balances: [] });
    }

    const status = await baw.walletStatus();
    if (status !== 'CONNECTED') {
      return c.json({ status, settings: null, balances: [] });
    }

    const [settings, balances] = await Promise.all([baw.walletSettings(), baw.walletBalance()]);
    return c.json({ status, settings, balances });
  });

  app.get('/api/bazaar/search', async (c) => {
    const bazaar = deps.bazaar;
    if (!bazaar) {
      throw new ApiError(503, 'this agent has no Bazaar connection configured');
    }

    const query = parse(searchQuerySchema, c.req.query());
    // A search with no price named is not a search at any price. The rulebook's
    // per-call cap is what Olai could actually pay, so it is what the dashboard
    // sees, and an edit to the rulebook moves it on the next search.
    const rulebook = deps.rulebooks.load() ?? defaultRulebook;
    const resources = await bazaar.search({
      query: query.query,
      maxUsdPrice: query.maxUsdPrice ?? rulebook.maxDataSpendUsdPerCall,
    });

    return c.json({ resources });
  });

  /**
   * The thinking feed.
   *
   * The first thing written is a ready event, so a client knows its
   * subscription is live before it does anything that would produce one. The
   * heartbeat comment after that keeps proxies from closing an idle stream, and
   * its timer is unreferenced so a quiet stream never holds the process open.
   */
  app.get('/api/events', (c) => {
    if (deps.events.openStreams >= MAX_EVENT_STREAMS) {
      throw new ApiError(503, 'too many event streams are already open');
    }

    return streamSSE(c, async (stream) => {
      let stop = () => {};
      const finished = new Promise<void>((resolve) => {
        stop = resolve;
      });

      const unsubscribe = deps.events.subscribe((event) => {
        void stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
      });

      const heartbeat = setInterval(() => {
        void stream.write(': heartbeat\n\n');
      }, HEARTBEAT_MS);
      heartbeat.unref();

      stream.onAbort(() => {
        unsubscribe();
        clearInterval(heartbeat);
        stop();
      });

      try {
        await stream.writeSSE({
          event: 'ready',
          data: JSON.stringify({ at: new Date().toISOString() }),
        });
        await finished;
      } finally {
        unsubscribe();
        clearInterval(heartbeat);
      }
    });
  });

  app.notFound((c) => c.json({ error: 'no such route on the owner API' }, 404));

  app.onError((error, c) => {
    const failure = toFailure(error);

    if (failure.unexpected) {
      log.error(
        { err: error, ip: clientIp(c, trustProxy), method: c.req.method, path: c.req.path },
        'the owner API could not answer a request',
      );
    }

    return c.json(failure.body, failure.status);
  });

  return app;
}

function sessionId(c: Context): string {
  const id = c.req.param('id');
  if (!id || id.length > 128) {
    throw new ApiError(400, 'that is not a session id');
  }
  return id;
}

/**
 * Reads the body as JSON.
 *
 * An empty body is an empty object, so a button with nothing to say does not
 * have to send one. Anything else that is not JSON is the caller's mistake and
 * is told so plainly.
 */
async function readJson(c: Context): Promise<unknown> {
  const text = await c.req.text();
  if (text.trim() === '') {
    return {};
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ApiError(400, 'the request body is not valid JSON');
  }
}

function parse<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ApiError(400, 'that request is not one Olai can read', result.error.issues);
  }
  return result.data;
}

/** An empty kinds parameter means every kind, not no kinds. */
function readKinds(raw: string | undefined): LedgerKind[] | undefined {
  if (raw === undefined) {
    return undefined;
  }

  const kinds = raw
    .split(',')
    .map((kind) => kind.trim())
    .filter((kind) => kind !== '');

  if (kinds.length === 0) {
    return undefined;
  }

  for (const kind of kinds) {
    if (!knownKinds.has(kind)) {
      throw new ApiError(400, `the ledger has no kind called ${kind}`);
    }
  }

  return kinds as LedgerKind[];
}
