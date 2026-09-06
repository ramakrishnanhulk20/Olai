import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { BinanceOAuth } from './oauth.js';

/**
 * The MCP session with Binance.
 *
 * The SDK's streamable HTTP transport does the protocol work and, given the
 * OAuth adapter, attaches the bearer token and retries once after a 401. This
 * class only adds the two things Olai needs on top: a single place that owns
 * the connection lifetime, and a call result flattened into plain data so the
 * rest of the agent never handles MCP content blocks.
 */

export class McpError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'McpError';
  }
}

export interface McpToolDescription {
  name: string;
  description?: string;
  inputSchema: unknown;
}

interface McpConfig {
  mcpUrl: string;
  oauth: BinanceOAuth;
  fetch?: typeof fetch;
  /**
   * Injected transport. Production leaves this unset and gets the HTTP transport;
   * tests pass the in-memory pair so the whole client can be exercised without a
   * network or a consent screen.
   */
  transport?: Transport;
}

const CLIENT_INFO = { name: 'olai', version: '0.1.0' };

export class BinanceMcp {
  private client: Client | null = null;
  private transport: Transport | null = null;

  constructor(private readonly cfg: McpConfig) {}

  /**
   * Opens the session, or does nothing if it is already open.
   *
   * Throws OAuthFlowError with code `consent_required` when nobody has approved
   * the consent screen yet, because that is a human step and the message says so.
   */
  async connect(): Promise<void> {
    if (this.client) return;

    const transport =
      this.cfg.transport ??
      new StreamableHTTPClientTransport(new URL(this.cfg.mcpUrl), {
        authProvider: this.cfg.oauth.authProvider(),
        ...(this.cfg.fetch === undefined ? {} : { fetch: this.cfg.fetch }),
      });

    const client = new Client(CLIENT_INFO, { capabilities: {} });
    await client.connect(transport);
    this.client = client;
    this.transport = transport;
  }

  /** Every tool the server offers. Connects first if needed. */
  async listTools(): Promise<McpToolDescription[]> {
    const client = await this.ready();
    const result = await client.listTools();
    return result.tools.map((tool) => ({
      name: tool.name,
      ...(tool.description === undefined ? {} : { description: tool.description }),
      inputSchema: tool.inputSchema,
    }));
  }

  /**
   * Runs one tool and returns its payload as plain data.
   *
   * Prefers the server's structured content. Otherwise a single text block that
   * parses as JSON is returned parsed, a single text block that does not is
   * returned as the string, and anything else is handed back whole for the caller
   * to inspect. Throws McpError when the server marks the result as an error.
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const client = await this.ready();
    const result = await client.callTool({ name, arguments: args });

    const content = Array.isArray(result.content) ? (result.content as ContentBlock[]) : [];

    if (result.isError === true) {
      throw new McpError('tool_error', `${name} failed: ${textOf(content) || 'no detail given'}`);
    }

    if (result.structuredContent !== undefined) return result.structuredContent;

    const texts = content.filter((block) => block.type === 'text').map((block) => block.text ?? '');
    if (texts.length === 1) {
      const only = texts[0] ?? '';
      try {
        return JSON.parse(only) as unknown;
      } catch {
        return only;
      }
    }

    return { content };
  }

  async close(): Promise<void> {
    const transport = this.transport;
    this.client = null;
    this.transport = null;
    await transport?.close();
  }

  private async ready(): Promise<Client> {
    await this.connect();
    if (!this.client) throw new McpError('not_connected', 'The MCP session is not open.');
    return this.client;
  }
}

interface ContentBlock {
  type: string;
  text?: string;
}

function textOf(content: ContentBlock[]): string {
  return content
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join(' ')
    .trim();
}
