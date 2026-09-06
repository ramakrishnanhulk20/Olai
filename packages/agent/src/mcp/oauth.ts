import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  discoverOAuthServerInfo,
  exchangeAuthorization,
  refreshAuthorization,
  startAuthorization as sdkStartAuthorization,
} from '@modelcontextprotocol/sdk/client/auth.js';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  AuthorizationServerMetadata,
  OAuthClientInformation,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';

/**
 * Olai's own connection to Binance's MCP server.
 *
 * Binance publishes no client registration endpoint, so there is nothing to sign
 * up for. Instead the authorization server accepts a URL as the client id and
 * fetches the client's own description from it (client_id_metadata_document_supported
 * is true in their metadata). That is why Olai serves its description at
 * `${publicBaseUrl}/oauth/client-metadata.json` and hands Binance that same URL as
 * the client id. Olai is its own registered client, never borrowing another
 * vendor's id.
 *
 * The flow itself is the MCP authorization spec, run through the MCP SDK's own
 * functions so the request shapes stay correct as the spec moves: PKCE with S256,
 * a state check on the callback, and the RFC 8707 `resource` parameter pinning the
 * token to the one MCP server it is allowed to reach.
 */

export interface OAuthConfig {
  /** The MCP server address. Doubles as the RFC 8707 resource the token is bound to. */
  mcpUrl: string;
  /** The address Binance can reach Olai on. Must be public for the consent step. */
  publicBaseUrl: string;
  tokenPath: string;
  clientName: string;
}

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  /** Milliseconds since the epoch. Absent when the server did not say. */
  expiresAt?: number;
  scope?: string;
}

export class OAuthFlowError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'OAuthFlowError';
  }
}

/** Refresh this far ahead of expiry so a call in flight does not die mid-request. */
const REFRESH_WINDOW_MS = 60_000;

const TOKEN_FILE_MODE = 0o600;

// The token file is written by this class alone, so the realistic failure is a
// truncated or hand-edited file rather than a hostile one. It still goes through
// a schema, because a half-written token that looks valid would fail much later
// as an unexplained 401.
const storedTokenSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1).optional(),
  expiresAt: z.number().optional(),
  scope: z.string().optional(),
});

function base64url(bytes: Buffer): string {
  return bytes.toString('base64url');
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

interface PendingAuthorization {
  state: string;
  codeVerifier: string;
  authorizationServerUrl: string;
  metadata?: AuthorizationServerMetadata;
}

interface DiscoveredServer {
  authorizationServerUrl: string;
  metadata?: AuthorizationServerMetadata;
  scope?: string;
}

export class BinanceOAuth {
  private readonly base: string;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private pending: PendingAuthorization | null = null;
  private discovered: DiscoveredServer | null = null;
  private cached: TokenSet | null = null;
  private cacheLoaded = false;

  constructor(
    private readonly cfg: OAuthConfig,
    deps: { fetch?: typeof fetch; now?: () => number } = {},
  ) {
    this.base = trimSlash(cfg.publicBaseUrl);
    this.fetchFn = deps.fetch ?? fetch;
    this.now = deps.now ?? Date.now;
  }

  /** The URL Binance fetches to learn who Olai is. It is also Olai's client id. */
  get clientId(): string {
    return `${this.base}/oauth/client-metadata.json`;
  }

  get redirectUri(): string {
    return `${this.base}/oauth/callback`;
  }

  /**
   * The client metadata document served at `${publicBaseUrl}/oauth/client-metadata.json`.
   *
   * `client_id` inside the document must equal the URL the document is served
   * from, otherwise the authorization server rejects the client.
   */
  clientMetadata(): Record<string, unknown> {
    return {
      client_id: this.clientId,
      client_name: this.cfg.clientName,
      redirect_uris: [this.redirectUri],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    };
  }

  /**
   * Builds the URL a human opens to approve Olai's access.
   *
   * Discovers the authorization server from the MCP URL, mints a PKCE verifier
   * and a state value, and keeps both in memory until the callback arrives. A
   * restart between the two steps simply means starting again, which is safer
   * than writing a live code verifier to disk.
   *
   * @returns the URL to open and the state value the callback must echo back.
   */
  async startAuthorization(): Promise<{ authorizeUrl: string; state: string }> {
    const server = await this.discover();
    const state = base64url(randomBytes(16));

    const { authorizationUrl, codeVerifier } = await sdkStartAuthorization(
      server.authorizationServerUrl,
      {
        metadata: server.metadata,
        clientInformation: this.clientInformation(),
        redirectUrl: this.redirectUri,
        state,
        ...(server.scope === undefined ? {} : { scope: server.scope }),
        resource: new URL(this.cfg.mcpUrl),
      },
    );

    this.pending = {
      state,
      codeVerifier,
      authorizationServerUrl: server.authorizationServerUrl,
      ...(server.metadata === undefined ? {} : { metadata: server.metadata }),
    };

    return { authorizeUrl: authorizationUrl.toString(), state };
  }

  /**
   * Completes the flow from the query string Binance redirects back with.
   *
   * Throws OAuthFlowError when the authorization server reported an error, when
   * no flow is in progress, when the state does not match the one we sent (which
   * is what stops a stranger from feeding us their own code), or when no code
   * came back. On success the token is written to disk with owner-only
   * permissions and returned.
   */
  async handleCallback(query: { code?: string; state?: string; error?: string }): Promise<TokenSet> {
    if (query.error) {
      this.pending = null;
      throw new OAuthFlowError('authorization_denied', `Binance refused the request: ${query.error}`);
    }

    const pending = this.pending;
    if (!pending) {
      throw new OAuthFlowError(
        'no_pending_authorization',
        'No authorization is in progress. Start again at /oauth/start.',
      );
    }

    if (!query.state || query.state !== pending.state) {
      this.pending = null;
      throw new OAuthFlowError(
        'state_mismatch',
        'The state value did not match the one Olai sent. The flow was abandoned.',
      );
    }

    if (!query.code) {
      this.pending = null;
      throw new OAuthFlowError('missing_code', 'Binance redirected back without an authorization code.');
    }

    const tokens = await exchangeAuthorization(pending.authorizationServerUrl, {
      metadata: pending.metadata,
      clientInformation: this.clientInformation(),
      authorizationCode: query.code,
      codeVerifier: pending.codeVerifier,
      redirectUri: this.redirectUri,
      resource: new URL(this.cfg.mcpUrl),
      fetchFn: this.fetchFn,
    });

    this.pending = null;
    const token = this.toTokenSet(tokens);
    await this.save(token);
    return token;
  }

  /**
   * The token Olai should send right now, or null if it has never connected.
   *
   * Refreshes when the access token is within a minute of expiry and a refresh
   * token exists. If the refresh itself fails the old token is returned rather
   * than throwing, so the caller sees the real 401 from Binance instead of a
   * refresh error that hides it.
   */
  async currentToken(): Promise<TokenSet | null> {
    const token = await this.load();
    if (!token) return null;

    const expiring = token.expiresAt !== undefined && token.expiresAt - this.now() <= REFRESH_WINDOW_MS;
    if (!expiring || !token.refreshToken) return token;

    try {
      const server = await this.discover();
      const refreshed = await refreshAuthorization(server.authorizationServerUrl, {
        metadata: server.metadata,
        clientInformation: this.clientInformation(),
        refreshToken: token.refreshToken,
        resource: new URL(this.cfg.mcpUrl),
        fetchFn: this.fetchFn,
      });
      const next = this.toTokenSet(refreshed);
      await this.save(next);
      return next;
    } catch {
      return token;
    }
  }

  /** Forgets the saved token and any half-finished flow. */
  async clear(): Promise<void> {
    this.pending = null;
    this.cached = null;
    this.cacheLoaded = true;
    await rm(this.cfg.tokenPath, { force: true });
  }

  /**
   * The adapter the MCP SDK's transport uses to attach the bearer token and to
   * refresh it after a 401. It shares this class's token file, so connecting
   * through the transport and connecting through the routes are the same session.
   */
  authProvider(): OAuthClientProvider {
    const owner = this;
    return {
      get redirectUrl(): string {
        return owner.redirectUri;
      },
      clientMetadataUrl: owner.clientId,
      get clientMetadata(): OAuthClientMetadata {
        return {
          client_name: owner.cfg.clientName,
          redirect_uris: [owner.redirectUri],
          token_endpoint_auth_method: 'none',
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
        };
      },
      clientInformation(): OAuthClientInformation {
        return owner.clientInformation();
      },
      async tokens(): Promise<OAuthTokens | undefined> {
        const token = await owner.currentToken();
        if (!token) return undefined;
        return {
          access_token: token.accessToken,
          token_type: 'Bearer',
          ...(token.refreshToken === undefined ? {} : { refresh_token: token.refreshToken }),
          ...(token.scope === undefined ? {} : { scope: token.scope }),
          ...(token.expiresAt === undefined
            ? {}
            : { expires_in: Math.max(0, Math.round((token.expiresAt - owner.now()) / 1000)) }),
        };
      },
      async saveTokens(tokens: OAuthTokens): Promise<void> {
        await owner.save(owner.toTokenSet(tokens));
      },
      state(): string {
        const state = base64url(randomBytes(16));
        owner.pending = {
          state,
          codeVerifier: owner.pending?.codeVerifier ?? '',
          authorizationServerUrl: owner.discovered?.authorizationServerUrl ?? owner.cfg.mcpUrl,
          ...(owner.discovered?.metadata === undefined ? {} : { metadata: owner.discovered.metadata }),
        };
        return state;
      },
      saveCodeVerifier(codeVerifier: string): void {
        owner.pending = {
          state: owner.pending?.state ?? '',
          codeVerifier,
          authorizationServerUrl: owner.discovered?.authorizationServerUrl ?? owner.cfg.mcpUrl,
          ...(owner.discovered?.metadata === undefined ? {} : { metadata: owner.discovered.metadata }),
        };
      },
      codeVerifier(): string {
        const verifier = owner.pending?.codeVerifier;
        if (!verifier) {
          throw new OAuthFlowError('no_pending_authorization', 'No PKCE verifier is in memory.');
        }
        return verifier;
      },
      redirectToAuthorization(): never {
        // Olai runs headless. Nobody can be redirected from here, so say what a
        // human has to do instead of failing with a bare 401 later.
        throw new OAuthFlowError(
          'consent_required',
          `Olai is not connected to Binance. Open ${owner.base}/oauth/start in a browser signed in to Binance and approve the consent screen.`,
        );
      },
      async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): Promise<void> {
        if (scope === 'all' || scope === 'tokens') await owner.clear();
        if (scope === 'all' || scope === 'discovery') owner.discovered = null;
        if (scope === 'all' || scope === 'verifier') owner.pending = null;
      },
    };
  }

  private clientInformation(): OAuthClientInformation {
    return { client_id: this.clientId };
  }

  private async discover(): Promise<DiscoveredServer> {
    if (this.discovered) return this.discovered;

    const info = await discoverOAuthServerInfo(this.cfg.mcpUrl, { fetchFn: this.fetchFn });
    const scope = info.resourceMetadata?.scopes_supported?.join(' ');
    this.discovered = {
      authorizationServerUrl: info.authorizationServerUrl,
      ...(info.authorizationServerMetadata === undefined
        ? {}
        : { metadata: info.authorizationServerMetadata }),
      ...(scope === undefined || scope === '' ? {} : { scope }),
    };
    return this.discovered;
  }

  private toTokenSet(tokens: OAuthTokens): TokenSet {
    return {
      accessToken: tokens.access_token,
      ...(tokens.refresh_token === undefined ? {} : { refreshToken: tokens.refresh_token }),
      ...(tokens.expires_in === undefined ? {} : { expiresAt: this.now() + tokens.expires_in * 1000 }),
      ...(tokens.scope === undefined ? {} : { scope: tokens.scope }),
    };
  }

  private async load(): Promise<TokenSet | null> {
    if (this.cacheLoaded) return this.cached;

    try {
      const text = await readFile(this.cfg.tokenPath, 'utf8');
      const parsed = storedTokenSchema.safeParse(JSON.parse(text) as unknown);
      this.cached = parsed.success ? parsed.data : null;
    } catch {
      // A missing or unreadable token file means "not connected yet", which is a
      // normal first-run state, not an error worth crashing the service over.
      this.cached = null;
    }
    this.cacheLoaded = true;
    return this.cached;
  }

  private async save(token: TokenSet): Promise<void> {
    await mkdir(dirname(this.cfg.tokenPath), { recursive: true });
    await writeFile(this.cfg.tokenPath, JSON.stringify(token, null, 2), {
      encoding: 'utf8',
      mode: TOKEN_FILE_MODE,
    });
    try {
      // writeFile only applies the mode when it creates the file, so an existing
      // file keeps its old permissions unless we set them again.
      await chmod(this.cfg.tokenPath, TOKEN_FILE_MODE);
    } catch {
      // Windows has no POSIX permission bits. Nothing to tighten there.
    }
    this.cached = token;
    this.cacheLoaded = true;
  }
}

/**
 * The five routes that get a human through the consent screen and let the rest
 * of Olai see whether it is connected. No route ever returns the access token.
 */
export function oauthRoutes(oauth: BinanceOAuth): Hono {
  const app = new Hono();

  app.get('/oauth/client-metadata.json', (c) => c.json(oauth.clientMetadata()));

  app.get('/oauth/start', async (c) => {
    try {
      const { authorizeUrl } = await oauth.startAuthorization();
      return c.redirect(authorizeUrl, 302);
    } catch (error) {
      return c.json({ error: 'start_failed', message: messageOf(error) }, 502);
    }
  });

  app.get('/oauth/callback', async (c) => {
    const query = c.req.query();
    try {
      const token = await oauth.handleCallback({
        ...(query['code'] === undefined ? {} : { code: query['code'] }),
        ...(query['state'] === undefined ? {} : { state: query['state'] }),
        ...(query['error'] === undefined ? {} : { error: query['error'] }),
      });
      return c.json({
        connected: true,
        scope: token.scope ?? null,
        expiresAt: token.expiresAt ?? null,
      });
    } catch (error) {
      const code = error instanceof OAuthFlowError ? error.code : 'callback_failed';
      return c.json({ connected: false, error: code, message: messageOf(error) }, 400);
    }
  });

  app.get('/oauth/status', async (c) => {
    const token = await oauth.currentToken();
    return c.json({
      connected: token !== null,
      clientId: oauth.clientId,
      scope: token?.scope ?? null,
      expiresAt: token?.expiresAt ?? null,
    });
  });

  app.post('/oauth/disconnect', async (c) => {
    await oauth.clear();
    return c.json({ connected: false });
  });

  return app;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
