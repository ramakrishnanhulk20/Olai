import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BinanceOAuth, oauthRoutes } from '../../src/mcp/oauth.js';

// What this file does NOT cover: the real Binance authorization server, which
// sits behind a WAF and needs a human at a browser, and the transport's own
// retry after a live 401. Every request here is answered by a fake fetch shaped
// like the documents Binance actually returns.

const MCP_URL = 'https://agent.binance.com/mcp/agentic';
const BASE = 'https://olai.example.com';
const TOKEN_ENDPOINT = 'https://accounts.binance.com/oauth-agentic/token';

interface Recorded {
  url: string;
  body: URLSearchParams;
}

function binanceFake(tokenResponses: Array<Record<string, unknown>>) {
  const calls: Recorded[] = [];

  const fetchFn: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

    if (url.includes('oauth-protected-resource')) {
      return Response.json({
        resource: MCP_URL,
        authorization_servers: ['https://agent.binance.com'],
      });
    }

    if (url.includes('oauth-authorization-server')) {
      return Response.json({
        issuer: 'https://agent.binance.com',
        authorization_endpoint: 'https://accounts.binance.com/agentic-oauth/authorize',
        token_endpoint: TOKEN_ENDPOINT,
        token_endpoint_auth_methods_supported: ['none'],
        grant_types_supported: ['authorization_code'],
        response_types_supported: ['code'],
        code_challenge_methods_supported: ['S256'],
        client_id_metadata_document_supported: true,
      });
    }

    if (url === TOKEN_ENDPOINT) {
      calls.push({ url, body: new URLSearchParams(String(init?.body ?? '')) });
      const next = tokenResponses.shift();
      if (!next) return new Response('{"error":"invalid_grant"}', { status: 400 });
      return Response.json(next);
    }

    return new Response('unexpected request', { status: 404 });
  };

  return { fetchFn, calls };
}

function base64urlSha256(value: string): string {
  return createHash('sha256').update(value).digest('base64url');
}

describe('BinanceOAuth', () => {
  let dir: string;
  let tokenPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'olai-oauth-'));
    tokenPath = join(dir, 'token.json');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const build = (tokenResponses: Array<Record<string, unknown>> = [], now = () => 1_700_000_000_000) => {
    const fake = binanceFake(tokenResponses);
    const oauth = new BinanceOAuth(
      { mcpUrl: MCP_URL, publicBaseUrl: `${BASE}/`, tokenPath, clientName: 'Olai' },
      { fetch: fake.fetchFn, now },
    );
    return { oauth, fake };
  };

  it('serves a client metadata document whose client_id is its own address', () => {
    const { oauth } = build();

    expect(oauth.clientMetadata()).toEqual({
      client_id: `${BASE}/oauth/client-metadata.json`,
      client_name: 'Olai',
      redirect_uris: [`${BASE}/oauth/callback`],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    });
  });

  it('builds an authorize URL with the metadata document as the client id, PKCE and the resource', async () => {
    const { oauth } = build();

    const { authorizeUrl, state } = await oauth.startAuthorization();
    const url = new URL(authorizeUrl);

    expect(url.origin + url.pathname).toBe('https://accounts.binance.com/agentic-oauth/authorize');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe(`${BASE}/oauth/client-metadata.json`);
    expect(url.searchParams.get('redirect_uri')).toBe(`${BASE}/oauth/callback`);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBe(state);
    expect(url.searchParams.get('resource')).toBe(MCP_URL);
    expect(url.searchParams.get('code_challenge')).toMatch(/^[\w-]{43}$/);
  });

  // The challenge must be the S256 hash of the verifier the token request later
  // proves Olai holds. That link is the whole point of PKCE.
  it('links the code challenge to the verifier it sends at the token endpoint', async () => {
    const { oauth, fake } = build([
      { access_token: 'access-1', token_type: 'Bearer', expires_in: 3600 },
    ]);

    const { authorizeUrl, state } = await oauth.startAuthorization();
    const challenge = new URL(authorizeUrl).searchParams.get('code_challenge') ?? '';

    await oauth.handleCallback({ code: 'code-1', state });

    const body = fake.calls[0]?.body;
    expect(body?.get('grant_type')).toBe('authorization_code');
    expect(body?.get('client_id')).toBe(`${BASE}/oauth/client-metadata.json`);
    expect(body?.get('resource')).toBe(MCP_URL);
    expect(base64urlSha256(body?.get('code_verifier') ?? '')).toBe(challenge);
  });

  it('refuses a callback whose state does not match the one it sent', async () => {
    const { oauth } = build();
    await oauth.startAuthorization();

    await expect(oauth.handleCallback({ code: 'code-1', state: 'not-the-state' })).rejects.toThrow(
      /state value did not match/,
    );
  });

  it('refuses a callback that carries an error instead of a code', async () => {
    const { oauth } = build();
    await oauth.startAuthorization();

    await expect(oauth.handleCallback({ error: 'access_denied' })).rejects.toThrow(/access_denied/);
  });

  it('saves the token to disk, owner only, and keeps it out of the status route', async () => {
    const { oauth } = build([
      { access_token: 'access-1', token_type: 'Bearer', expires_in: 3600, refresh_token: 'refresh-1', scope: 'trade' },
    ]);

    const { state } = await oauth.startAuthorization();
    const token = await oauth.handleCallback({ code: 'code-1', state });

    expect(token).toEqual({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresAt: 1_700_000_000_000 + 3_600_000,
      scope: 'trade',
    });

    const onDisk = JSON.parse(await readFile(tokenPath, 'utf8')) as Record<string, unknown>;
    expect(onDisk['accessToken']).toBe('access-1');

    // Windows has no POSIX permission bits, so the mode check only runs where it
    // means something.
    if (process.platform !== 'win32') {
      const info = await stat(tokenPath);
      expect(info.mode & 0o777).toBe(0o600);
    }
  });

  it('refreshes a token that is inside the last minute of its life', async () => {
    let clock = 1_700_000_000_000;
    const { oauth, fake } = build(
      [
        { access_token: 'access-1', token_type: 'Bearer', expires_in: 3600, refresh_token: 'refresh-1' },
        { access_token: 'access-2', token_type: 'Bearer', expires_in: 3600, refresh_token: 'refresh-2' },
      ],
      () => clock,
    );

    const { state } = await oauth.startAuthorization();
    await oauth.handleCallback({ code: 'code-1', state });

    expect((await oauth.currentToken())?.accessToken).toBe('access-1');

    clock += 3_600_000 - 30_000;
    const refreshed = await oauth.currentToken();

    expect(refreshed?.accessToken).toBe('access-2');
    expect(fake.calls[1]?.body.get('grant_type')).toBe('refresh_token');
    expect(fake.calls[1]?.body.get('refresh_token')).toBe('refresh-1');
  });

  it('keeps the old token when the refresh fails, so the real 401 surfaces instead', async () => {
    let clock = 1_700_000_000_000;
    const { oauth } = build(
      [{ access_token: 'access-1', token_type: 'Bearer', expires_in: 3600, refresh_token: 'refresh-1' }],
      () => clock,
    );

    const { state } = await oauth.startAuthorization();
    await oauth.handleCallback({ code: 'code-1', state });

    clock += 3_600_000;
    expect((await oauth.currentToken())?.accessToken).toBe('access-1');
  });

  it('forgets everything on clear', async () => {
    const { oauth } = build([{ access_token: 'access-1', token_type: 'Bearer', expires_in: 3600 }]);

    const { state } = await oauth.startAuthorization();
    await oauth.handleCallback({ code: 'code-1', state });
    await oauth.clear();

    expect(await oauth.currentToken()).toBeNull();
  });
});

describe('oauthRoutes', () => {
  let dir: string;
  let tokenPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'olai-oauth-routes-'));
    tokenPath = join(dir, 'token.json');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const build = () => {
    const fake = binanceFake([
      { access_token: 'access-1', token_type: 'Bearer', expires_in: 3600, scope: 'trade' },
    ]);
    const oauth = new BinanceOAuth(
      { mcpUrl: MCP_URL, publicBaseUrl: BASE, tokenPath, clientName: 'Olai' },
      { fetch: fake.fetchFn, now: () => 1_700_000_000_000 },
    );
    return { app: oauthRoutes(oauth), oauth };
  };

  it('serves the client metadata document as JSON', async () => {
    const { app } = build();

    const res = await app.request('/oauth/client-metadata.json');
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body['client_id']).toBe(`${BASE}/oauth/client-metadata.json`);
  });

  it('redirects the browser to Binance from /oauth/start', async () => {
    const { app } = build();

    const res = await app.request('/oauth/start');

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('accounts.binance.com/agentic-oauth/authorize');
  });

  it('reports not connected before the flow, and connected after the callback', async () => {
    const { app, oauth } = build();

    const before = (await (await app.request('/oauth/status')).json()) as Record<string, unknown>;
    expect(before['connected']).toBe(false);

    const { state } = await oauth.startAuthorization();
    const callback = await app.request(`/oauth/callback?code=code-1&state=${state}`);
    expect(callback.status).toBe(200);

    const after = (await (await app.request('/oauth/status')).json()) as Record<string, unknown>;
    expect(after['connected']).toBe(true);
    expect(after['scope']).toBe('trade');
    // The access token is a bearer credential. No route may hand it out.
    expect(JSON.stringify(after)).not.toContain('access-1');
  });

  it('answers 400 with a reason when the callback state is wrong', async () => {
    const { app, oauth } = build();
    await oauth.startAuthorization();

    const res = await app.request('/oauth/callback?code=code-1&state=wrong');
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(400);
    expect(body['error']).toBe('state_mismatch');
  });

  it('disconnects on POST and reports not connected afterwards', async () => {
    const { app, oauth } = build();
    const { state } = await oauth.startAuthorization();
    await app.request(`/oauth/callback?code=code-1&state=${state}`);

    const res = await app.request('/oauth/disconnect', { method: 'POST' });
    expect(res.status).toBe(200);

    const status = (await (await app.request('/oauth/status')).json()) as Record<string, unknown>;
    expect(status['connected']).toBe(false);
  });
});
