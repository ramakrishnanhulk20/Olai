/**
 * Which Binance MCP tool answers which question.
 *
 * Binance publishes no tool list, so the names are discovered at runtime from
 * tools/list and matched here by keyword. This file is deliberately the only
 * place in Olai that decides a tool name: when the real list is known, the
 * patterns below or a set of overrides fix the mapping in one spot and nothing
 * else has to change.
 */

export interface ToolMap {
  ticker: string;
  orderBook: string;
  klines: string;
  balances: string;
  /** Optional: a spot-only server has no positions tool and that is not a failure. */
  positions?: string;
  placeOrder: string;
  orderStatus: string;
}

export class ToolMapError extends Error {
  constructor(
    readonly missing: string[],
    readonly candidates: string[],
  ) {
    super(
      `Could not match ${missing.join(', ')} to any Binance MCP tool. ` +
        `The server offers: ${candidates.length > 0 ? candidates.join(', ') : '(no tools at all)'}. ` +
        `Fix this by passing overrides to resolveToolMap.`,
    );
    this.name = 'ToolMapError';
  }
}

export interface ToolDescription {
  name: string;
  description?: string;
}

interface Rule {
  /** Name patterns in priority order. An earlier pattern beats a later one. */
  name: RegExp[];
  /** A tool whose name matches any of these can never fill the slot. */
  deny?: RegExp[];
  /** Weak evidence from the description, used only to break a tie. */
  hint?: RegExp[];
}

/**
 * Turns a tool name into spaced words before matching.
 *
 * An underscore counts as a word character in a regular expression, so `\bprice\b`
 * never matches `get_price`. Splitting `get_price` and `getPrice` into "get price"
 * first lets every pattern below use plain word boundaries and stay readable.
 */
function words(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Order matters. The narrow slots are resolved first so that a generic word like
 * "order" cannot be eaten by the wrong one: once a tool is claimed it is out of
 * the running for every later slot.
 */
const RULES: Array<[keyof ToolMap, Rule]> = [
  [
    'klines',
    {
      name: [/\bklines?\b/, /\bcandle/, /\bohlc\b/, /\bbars?\b/],
      hint: [/candle|kline|interval/i],
    },
  ],
  [
    'orderBook',
    {
      name: [/\border book\b/, /\bdepth\b/, /\bbook\b/],
      deny: [/\bhistory\b/, /\bplace\b/, /\bcancel\b/, /\btrades?\b/],
      hint: [/bids?|asks?|order book/i],
    },
  ],
  [
    'ticker',
    {
      name: [/\bticker\b/, /\bprice\b/, /\bquote\b/, /\bmarket data\b/],
      deny: [/\border\b/, /\bkline/, /\bcandle/, /\bbook\b/, /\bhistory\b/, /\blist\b/],
      hint: [/24h|last price|price change/i],
    },
  ],
  [
    'positions',
    {
      name: [/\bpositions?\b/],
      deny: [/\bclose\b/, /\bhistory\b/],
      hint: [/position/i],
    },
  ],
  [
    'balances',
    {
      name: [/\bbalances?\b/, /\bwallet\b/, /\baccount info\b/, /\bassets?\b/, /\baccount\b/],
      deny: [/\border\b/, /\btransfer\b/, /\bhistory\b/, /\bposition/, /\bwithdraw/],
      hint: [/balance|free|locked|holdings/i],
    },
  ],
  [
    'placeOrder',
    {
      name: [
        /\b(place|create|submit|send|new)\b.*\border\b/,
        /\border\b.*\b(place|create|submit|send)\b/,
        /\btrade\b/,
        /\bbuy\b|\bsell\b/,
      ],
      // Everything that reads, lists or undoes an order is barred, so the slot
      // that actually spends money can only ever be filled by a tool that sends one.
      deny: [
        /\bcancel\b/,
        /\bstatus\b/,
        /\bquery\b/,
        /\bget\b/,
        /\blist\b/,
        /\bhistory\b/,
        /\bbook\b/,
        /\bopen\b/,
        /\breplace\b/,
        /\bamend\b/,
      ],
      hint: [/place an order|submit an order|market order|buy or sell/i],
    },
  ],
  [
    'orderStatus',
    {
      name: [
        /\border status\b/,
        /\b(query|get|fetch|check)\b.*\border\b/,
        /\border\b.*\b(detail|info|status|query)\b/,
        /\border\b/,
      ],
      deny: [
        /\bcancel\b/,
        /\bplace\b/,
        /\bcreate\b/,
        /\bsubmit\b/,
        /\bnew\b/,
        /\bbook\b/,
        /\breplace\b/,
        /\bamend\b/,
        /\bopen\b/,
        /\blist\b/,
        /\bhistory\b/,
      ],
      hint: [/status of an order|order status|query an order/i],
    },
  ],
];

const REQUIRED: Array<keyof ToolMap> = [
  'ticker',
  'orderBook',
  'klines',
  'balances',
  'placeOrder',
  'orderStatus',
];

/**
 * Picks a tool name for every slot.
 *
 * An override wins over the keyword match, but the named tool must actually
 * exist on the server, otherwise the mistake would only surface as a failed
 * trade later.
 *
 * @throws ToolMapError naming every unfilled required slot and listing every
 * tool the server offers, so the fix is one glance away.
 */
export function resolveToolMap(tools: ToolDescription[], overrides: Partial<ToolMap> = {}): ToolMap {
  const available = new Set(tools.map((tool) => tool.name));
  const claimed = new Set<string>();
  const resolved: Partial<ToolMap> = {};
  const missing: string[] = [];

  for (const [slot, override] of Object.entries(overrides) as Array<[keyof ToolMap, string | undefined]>) {
    if (override === undefined) continue;
    if (!available.has(override)) {
      missing.push(`${slot} (override "${override}" is not offered by the server)`);
      continue;
    }
    resolved[slot] = override;
    claimed.add(override);
  }

  for (const [slot, rule] of RULES) {
    if (resolved[slot] !== undefined) continue;
    const pick = bestMatch(tools, rule, claimed);
    if (pick) {
      resolved[slot] = pick;
      claimed.add(pick);
    }
  }

  for (const slot of REQUIRED) {
    if (resolved[slot] === undefined && !missing.some((entry) => entry.startsWith(slot))) {
      missing.push(slot);
    }
  }

  if (missing.length > 0) {
    throw new ToolMapError(
      missing,
      tools.map((tool) => tool.name),
    );
  }

  return resolved as ToolMap;
}

function bestMatch(tools: ToolDescription[], rule: Rule, claimed: Set<string>): string | null {
  let winner: { name: string; score: number } | null = null;

  for (const tool of tools) {
    if (claimed.has(tool.name)) continue;
    const spaced = words(tool.name);
    if (rule.deny?.some((pattern) => pattern.test(spaced))) continue;

    const tier = rule.name.findIndex((pattern) => pattern.test(spaced));
    if (tier === -1) continue;

    let score = 100 - tier * 10;
    if (rule.hint?.some((pattern) => pattern.test(tool.description ?? ''))) score += 5;
    // A shorter name is the plainer tool: prefer get_ticker over get_ticker_batch.
    score -= tool.name.length / 100;

    if (!winner || score > winner.score) winner = { name: tool.name, score };
  }

  return winner?.name ?? null;
}
