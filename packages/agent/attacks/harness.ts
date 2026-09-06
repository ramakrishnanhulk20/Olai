import { mkdtempSync, rmSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import type { ServerType } from '@hono/node-server';
import { type Service, buildService } from '../src/boot.js';
import { loadConfig } from '../src/config.js';
import type { Rulebook } from '../src/policy/rulebook.js';
import { defaultRulebook } from '../src/rulebook/store.js';
import { Baw } from '../src/x402/baw.js';
import { type ScriptedTurn, fakeAnthropic } from './fake-anthropic.js';
import type { AttackStep } from './report.js';

/**
 * One running copy of Olai for one attack to shoot at.
 *
 * Each attack gets its own service, its own temporary ledger file and its own
 * free port. That costs a second or two per attack and buys independence: the
 * rate limit one attack burns through, or the rulebook another one rewrites,
 * cannot change the answer the next one gets.
 */

/** Not a secret. It exists so the attacks can hold a valid owner token, and it never leaves this repo. */
export const OWNER_TOKEN = 'ol.attack-run-token-not-for-production-1';

export const OWNER_HEADERS: Record<string, string> = { authorization: `Bearer ${OWNER_TOKEN}` };

export interface Harness {
  /** http://127.0.0.1:<port> */
  base: string;
  service: Service;
  dbPath: string;
  dir: string;
  stop(): Promise<void>;
}

export interface HarnessOptions {
  /** Goes in the temporary directory name, so a leftover folder says which attack made it. */
  name: string;
  /** One entry per toolRunner call the analyst makes. Leave it out when the attack never asks a question. */
  script?: ScriptedTurn[][];
  /** Answers every outbound call the service makes: Bazaar, merchants, OAuth. */
  fetch?: typeof fetch;
  baw?: Baw;
  env?: Record<string, string>;
}

export async function startService(opts: HarnessOptions): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), `olai-${opts.name}-`));
  const dbPath = join(dir, 'olai.db');

  const config = loadConfig({
    // A string that is long enough for the config schema and is not shaped like
    // an Anthropic key, so the secrets sweep in ATTACK-12 does not have to make
    // an exception for this file.
    ANTHROPIC_API_KEY: 'attacks-use-a-scripted-model-instead',
    OLAI_OWNER_TOKEN: OWNER_TOKEN,
    OLAI_DB_PATH: dbPath,
    OLAI_RULEBOOK_PATH: join(dir, 'rulebook.json'),
    OLAI_TOKEN_PATH: join(dir, 'binance-mcp-token.json'),
    OLAI_DRY_RUN: 'true',
    OLAI_EXCHANGE: 'fake',
    OLAI_WEB_ORIGIN: 'http://localhost:3000',
    // Nothing here reaches the OAuth flow. An https address only keeps the boot
    // warning about tunnels out of the run output.
    OLAI_PUBLIC_BASE_URL: 'https://olai-attack-run.invalid',
    ...opts.env,
  });

  const service = await buildService(config, {
    baw: opts.baw ?? stubBaw(),
    anthropic: fakeAnthropic(opts.script ?? []).client,
    fetch: opts.fetch ?? refusingFetch(),
  });

  const { server, port } = await listen(service);

  return {
    base: `http://127.0.0.1:${port}`,
    service,
    dbPath,
    dir,
    stop: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await service.close();
      rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
    },
  };
}

async function listen(service: Service): Promise<{ server: ServerType; port: number }> {
  return new Promise((resolve) => {
    const server = serve({ fetch: service.app.fetch, hostname: '127.0.0.1', port: 0 }, (info) =>
      resolve({ server, port: info.port }),
    );
  });
}

/**
 * A wallet that answers without going anywhere near the real CLI. Every attack
 * gets one of these, because an attack script that shells out to the owner's
 * signed-in wallet would be an attack on the owner.
 */
export function stubBaw(answer?: (args: string[]) => unknown): Baw {
  return new Baw({
    run: async (args) => {
      const data = answer?.(args) ?? defaultWalletAnswer(args);
      return { stdout: JSON.stringify({ success: true, data }), exitCode: 0 };
    },
  });
}

function defaultWalletAnswer(args: string[]): unknown {
  if (args[0] === 'wallet' && args[1] === 'status') {
    return { status: 'CONNECTED' };
  }
  return {};
}

/** Refuses every outbound call, so nothing an attack does can reach the real internet. */
export function refusingFetch(): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0]) =>
    new Response(JSON.stringify({ error: `the attack harness blocked an outbound call to ${String(input)}` }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
}

/** Builds a fetch from a list of matchers. Anything unmatched is refused the same way. */
export function routedFetch(
  routes: Array<{ when: (url: string, init?: RequestInit) => boolean; answer: (url: string, init?: RequestInit) => Response }>,
): typeof fetch {
  const refuse = refusingFetch();

  return (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(input);
    for (const route of routes) {
      if (route.when(url, init)) {
        return route.answer(url, init);
      }
    }
    return refuse(input, init);
  }) as typeof fetch;
}

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

export interface Capture extends AttackStep {
  status: number;
  headers: Headers;
  body: string;
  json(): unknown;
}

export interface CallOptions {
  method?: string;
  /** Left out means no Authorization header at all. */
  token?: string | null;
  body?: string;
  headers?: Record<string, string>;
}

const MAX_BODY_CHARS = 4000;

/**
 * One HTTP call, recorded the way it would be typed and the way it came back.
 *
 * Both strings go straight into the attack file, so they carry the real port,
 * the real headers and the real body rather than a description of them.
 */
export async function call(base: string, path: string, opts: CallOptions = {}): Promise<Capture> {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.token !== null && opts.token !== undefined) {
    headers['authorization'] = `Bearer ${opts.token}`;
  }

  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    ...(opts.body === undefined ? {} : { body: opts.body }),
  });

  const text = await response.text();
  return capture(`${method} ${base}${path}`, headers, opts.body, response.status, response.headers, text);
}

/**
 * The same call, but on a socket of its own.
 *
 * Node's fetch keeps one connection per address and sends one request at a time
 * down it, so two fetches fired together arrive at the server one after the
 * other. An attack about a race needs two connections, which is what agent:
 * false gives.
 */
export async function callOnOwnSocket(base: string, path: string, opts: CallOptions = {}): Promise<Capture> {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.token !== null && opts.token !== undefined) {
    headers['authorization'] = `Bearer ${opts.token}`;
  }

  const url = new URL(`${base}${path}`);

  return new Promise<Capture>((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method,
        headers,
        agent: false,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          const answered = new Headers();
          for (const [name, value] of Object.entries(response.headers)) {
            answered.set(name, Array.isArray(value) ? value.join(', ') : String(value ?? ''));
          }
          resolve(
            capture(
              `${method} ${base}${path}`,
              headers,
              opts.body,
              response.statusCode ?? 0,
              answered,
              Buffer.concat(chunks).toString('utf8'),
            ),
          );
        });
      },
    );

    request.on('error', reject);
    if (opts.body !== undefined) {
      request.write(opts.body);
    }
    request.end();
  });
}

function capture(
  requestLine: string,
  headers: Record<string, string>,
  requestBody: string | undefined,
  status: number,
  answered: Headers,
  text: string,
): Capture {
  const body =
    text.length > MAX_BODY_CHARS
      ? `${text.slice(0, MAX_BODY_CHARS)}\n[cut here, ${text.length - MAX_BODY_CHARS} more characters]`
      : text;

  const tried = [
    requestLine,
    ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
    ...(requestBody === undefined ? [] : ['', requestBody]),
  ].join('\n');

  const raw = [
    `HTTP ${status}`,
    ...[...answered.entries()]
      .filter(([name]) => name !== 'date')
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, value]) => `${name}: ${value}`),
    '',
    body === '' ? '(empty body)' : body,
  ].join('\n');

  return {
    status,
    headers: answered,
    body,
    tried,
    raw,
    json: () => JSON.parse(body) as unknown,
  };
}

/** A step for something that is not an HTTP call, such as a direct function call or a file read. */
export function step(tried: string, raw: string): AttackStep {
  return { tried, raw };
}

/**
 * A rulebook with room in it, so an attack that needs a proposal to reach the
 * owner is not refused for an unrelated reason. The fake exchange holds 1531
 * dollars of BNB, which the starter rulebook's 50 dollar position cap would
 * refuse on its own.
 */
export function roomyRulebook(overrides: Partial<Rulebook> = {}): Rulebook {
  return {
    ...defaultRulebook,
    name: 'Attack run rulebook',
    maxOrderUsd: 20,
    maxPositionUsdPerSymbol: 5000,
    cooldownSecondsBetweenOrders: 0,
    ...overrides,
  };
}

export function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
