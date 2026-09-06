import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { BinanceMcp, McpError } from '../../src/mcp/client.js';
import { BinanceOAuth } from '../../src/mcp/oauth.js';

// What this file does NOT cover: the streamable HTTP transport, the bearer token
// header, and the 401 retry, all of which belong to the SDK and to the live
// Binance server. Here the session runs over the SDK's in-memory transport pair,
// so it proves Olai's own handling of tools/list and tools/call and nothing more.

const oauth = new BinanceOAuth({
  mcpUrl: 'https://agent.binance.com/mcp/agentic',
  publicBaseUrl: 'https://olai.example.com',
  tokenPath: './data/never-written-in-this-file.json',
  clientName: 'Olai',
});

async function serverWithTools(): Promise<{ mcp: BinanceMcp; stop: () => Promise<void> }> {
  const server = new McpServer({ name: 'fake-binance', version: '0.0.1' });

  server.registerTool(
    'get_ticker',
    { description: 'Latest price for a symbol', inputSchema: { symbol: z.string() } },
    ({ symbol }) => ({
      content: [{ type: 'text' as const, text: JSON.stringify({ symbol, lastPrice: '64000.10' }) }],
    }),
  );

  server.registerTool('broken_tool', { description: 'Always fails' }, () => ({
    content: [{ type: 'text' as const, text: 'the venue said no' }],
    isError: true,
  }));

  server.registerTool('plain_text_tool', { description: 'Answers with prose' }, () => ({
    content: [{ type: 'text' as const, text: 'not json at all' }],
  }));

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const mcp = new BinanceMcp({
    mcpUrl: 'https://agent.binance.com/mcp/agentic',
    oauth,
    transport: clientTransport,
  });

  return {
    mcp,
    stop: async () => {
      await mcp.close();
      await server.close();
    },
  };
}

describe('BinanceMcp', () => {
  let stop: (() => Promise<void>) | null = null;

  afterEach(async () => {
    await stop?.();
    stop = null;
  });

  it('lists the tools the server offers, with their schemas', async () => {
    const session = await serverWithTools();
    stop = session.stop;

    const tools = await session.mcp.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual(['broken_tool', 'get_ticker', 'plain_text_tool']);
    const ticker = tools.find((tool) => tool.name === 'get_ticker');
    expect(ticker?.description).toBe('Latest price for a symbol');
    expect(ticker?.inputSchema).toBeDefined();
  });

  it('calls a tool and hands back its JSON payload as plain data', async () => {
    const session = await serverWithTools();
    stop = session.stop;

    const result = await session.mcp.callTool('get_ticker', { symbol: 'BTCUSDT' });

    expect(result).toEqual({ symbol: 'BTCUSDT', lastPrice: '64000.10' });
  });

  it('returns text as a string when the tool does not answer with JSON', async () => {
    const session = await serverWithTools();
    stop = session.stop;

    expect(await session.mcp.callTool('plain_text_tool', {})).toBe('not json at all');
  });

  it('throws with the server error text when the tool reports a failure', async () => {
    const session = await serverWithTools();
    stop = session.stop;

    await expect(session.mcp.callTool('broken_tool', {})).rejects.toThrow(McpError);
    await expect(session.mcp.callTool('broken_tool', {})).rejects.toThrow(/the venue said no/);
  });

  it('connects once, so a second call reuses the open session', async () => {
    const session = await serverWithTools();
    stop = session.stop;

    await session.mcp.connect();
    await session.mcp.connect();

    expect((await session.mcp.listTools()).length).toBe(3);
  });
});
