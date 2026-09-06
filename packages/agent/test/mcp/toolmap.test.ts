import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveToolMap, ToolMapError } from '../../src/mcp/toolmap.js';

// What this file does NOT cover: whether the names Binance actually publishes
// match these patterns. Until reference/mcp-tools.json exists the realistic list
// below is a stand-in shaped like Binance's REST surface, and the last test in
// this file switches to the real list the moment that file appears.

const REAL_TOOLS = join(process.cwd(), '..', '..', 'reference', 'mcp-tools.json');

const realisticTools = [
  { name: 'get_ticker', description: 'Latest price and 24h change for a symbol' },
  { name: 'get_symbol_price', description: 'Latest price only' },
  { name: 'get_order_book', description: 'Top bids and asks for a symbol' },
  { name: 'get_klines', description: 'Candlestick data for a symbol and interval' },
  { name: 'get_account_balances', description: 'Free and locked balance of every asset' },
  { name: 'get_positions', description: 'Open futures positions' },
  { name: 'place_spot_order', description: 'Submit a market or limit order' },
  { name: 'cancel_order', description: 'Cancel an open order' },
  { name: 'query_order', description: 'Status of an order by id' },
  { name: 'get_open_orders', description: 'List the orders still working' },
  { name: 'transfer_funds', description: 'Move funds between sub-accounts' },
];

describe('resolveToolMap', () => {
  it('picks one tool per slot from a realistic list', () => {
    expect(resolveToolMap(realisticTools)).toEqual({
      ticker: 'get_ticker',
      orderBook: 'get_order_book',
      klines: 'get_klines',
      balances: 'get_account_balances',
      positions: 'get_positions',
      placeOrder: 'place_spot_order',
      orderStatus: 'query_order',
    });
  });

  it('never lets a cancel tool stand in for placing or checking an order', () => {
    const map = resolveToolMap(realisticTools);

    expect(map.placeOrder).not.toBe('cancel_order');
    expect(map.orderStatus).not.toBe('cancel_order');
  });

  it('treats positions as optional, because a spot-only server has none', () => {
    const spotOnly = realisticTools.filter((tool) => tool.name !== 'get_positions');

    expect(resolveToolMap(spotOnly).positions).toBeUndefined();
  });

  it('throws with every candidate name listed when a required slot cannot be filled', () => {
    const noBook = realisticTools.filter((tool) => tool.name !== 'get_order_book');

    try {
      resolveToolMap(noBook);
      expect.unreachable('resolveToolMap should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ToolMapError);
      const failure = error as ToolMapError;
      expect(failure.missing).toContain('orderBook');
      expect(failure.candidates).toEqual(noBook.map((tool) => tool.name));
      expect(failure.message).toContain('get_ticker');
    }
  });

  it('prefers the plainest name when two tools could fill the same slot', () => {
    expect(resolveToolMap(realisticTools).ticker).toBe('get_ticker');
  });

  it('lets an override win, but only if the server really offers that tool', () => {
    const overridden = resolveToolMap(realisticTools, { ticker: 'get_symbol_price' });
    expect(overridden.ticker).toBe('get_symbol_price');

    expect(() => resolveToolMap(realisticTools, { ticker: 'no_such_tool' })).toThrow(ToolMapError);
  });

  it('rejects an empty tool list rather than guessing', () => {
    expect(() => resolveToolMap([])).toThrow(/no tools at all/);
  });

  // This test is the correction loop the work order asked for: once the OAuth
  // spike has written the real tool list, the default matching has to resolve
  // every slot against it, or the patterns above need fixing.
  it.skipIf(!existsSync(REAL_TOOLS))('resolves every slot against the real Binance tool list', () => {
    const file = JSON.parse(readFileSync(REAL_TOOLS, 'utf8')) as {
      tools?: Array<{ name: string; description?: string }>;
    };
    const tools = file.tools ?? [];

    const map = resolveToolMap(tools);
    const names = new Set(tools.map((tool) => tool.name));

    for (const slot of ['ticker', 'orderBook', 'klines', 'balances', 'placeOrder', 'orderStatus'] as const) {
      expect(names.has(map[slot])).toBe(true);
    }
  });
});
