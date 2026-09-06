import Anthropic from '@anthropic-ai/sdk';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import type { Ledger } from '../ledger/ledger.js';
import { type AccountState, evaluate } from '../policy/engine.js';
import type { Rulebook } from '../policy/rulebook.js';
import { type DataPort, withPaymentLock } from '../ports/data.js';
import type { ExchangePort } from '../ports/exchange.js';
import type { BuyRequest } from '../x402/buyer.js';
import { type MerchantHint, hintFor } from '../x402/merchants/hints.js';
import { type Proposal, proposalSchema } from './proposal.js';

/**
 * Olai's brain: one question in, one proposal out.
 *
 * The brain reads markets, buys data and argues with itself. It never places an
 * order and it never decides whether a rule applies. Both of those live outside
 * this file on purpose, because a model that can be talked into something is a
 * model that must not hold the controls.
 */

export type BrainEvent =
  | { type: 'thinking'; text: string }
  | { type: 'tool'; name: string; input: unknown }
  | { type: 'tool.result'; name: string; summary: string }
  | { type: 'text'; text: string }
  | { type: 'proposal'; proposal: Proposal };

export interface AnalystDeps {
  anthropic: Anthropic;
  exchange: ExchangePort;
  data: DataPort;
  ledger: Ledger;
  rulebook: Rulebook;
  /**
   * The account as it stands. The brain needs it to check a payment against the
   * rulebook before it spends, and to tell the model how much budget is left.
   */
  accountState: () => Promise<AccountState>;
  sessionId: string;
  dryRun: boolean;
  model?: string;
  onEvent?: (e: BrainEvent) => void;
}

/** What one turn through the payment queue ended in. */
type BuyStep =
  | { kind: 'refused'; summary: string }
  | { kind: 'failed'; reason: string }
  | { kind: 'bought'; outcome: Awaited<ReturnType<DataPort['buy']>> };

/** The model finished without ever calling propose, twice in a row. */
export class NoProposalError extends Error {
  override name = 'NoProposalError';
}

/** The model refused to answer at all. */
export class AnalystRefusedError extends Error {
  override name = 'AnalystRefusedError';
}

const DEFAULT_MODEL = 'claude-opus-5';
const MAX_TOKENS = 16_000;
const MAX_ITERATIONS = 12;
const MAX_SEARCH_RESULTS = 8;
const MAX_DATA_CHARS = 6000;
const MAX_DESCRIPTION_CHARS = 300;

// One dead merchant buys a second try. A second means paid data is not working
// for this question, and a third hunt only burns tokens and possibly money.
const MAX_FAILED_MERCHANTS = 2;
const TRY_ONE_MORE =
  'Try the next listing from search_bazaar once, then continue without paid data';
const NO_PAID_DATA = 'paid data is not available this session, proceed on free reads';

function clip(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}\n[cut here, ${text.length - max} more characters not shown]`;
}

function usd(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

function say(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The part of a hint the model needs: how to call the merchant, and one example that works. */
function describeRequest(hint: MerchantHint): Record<string, unknown> {
  return {
    method: hint.method,
    describe: hint.describe,
    url: hint.example.url,
    ...(hint.example.body === undefined ? {} : { body: hint.example.body }),
  };
}

/**
 * What the model already told us about the call, in the shape a hint wants. The
 * ticker can only come off the query string, since a GET has no body to read it
 * from.
 */
function requestContext(input: {
  url: string;
  body?: Record<string, unknown>;
}): { address?: string; symbol?: string } {
  const context: { address?: string; symbol?: string } = {};

  const address = input.body?.['address'];
  if (typeof address === 'string') {
    context.address = address;
  }

  const bodySymbol = input.body?.['symbol'];
  let symbol = typeof bodySymbol === 'string' ? bodySymbol : undefined;
  try {
    symbol = new URL(input.url).searchParams.get('symbol') ?? symbol;
  } catch {
    // Not a URL that parses. The hint falls back to its documented example.
  }
  if (symbol !== undefined) {
    context.symbol = symbol;
  }

  return context;
}

function renderRulebook(rulebook: Rulebook): string {
  const markets =
    rulebook.allowedSymbols.length > 0
      ? rulebook.allowedSymbols.join(', ')
      : 'none, so no order can be proposed';
  const hours = rulebook.tradingHoursUtc
    ? `${rulebook.tradingHoursUtc.start}:00 to ${rulebook.tradingHoursUtc.end}:00 UTC`
    : 'around the clock';
  const tiers =
    rulebook.drawdownTiers.length > 0
      ? rulebook.drawdownTiers
          .map((tier) => `${usd(tier.lossUsd)} ${tier.action === 'halt' ? 'stop' : 'halve size'}`)
          .join(', ')
      : 'none';

  return [
    `Rulebook: ${rulebook.name}`,
    `Markets allowed: ${markets}`,
    `Biggest single order: ${usd(rulebook.maxOrderUsd)}`,
    `Biggest position in one market: ${usd(rulebook.maxPositionUsdPerSymbol)}`,
    `Trading stops for the day at a loss of: ${usd(rulebook.maxDailyLossUsd)}`,
    `Drawdown steps: ${tiers}`,
    `Selling short: ${rulebook.allowShort ? 'allowed' : 'not allowed'}`,
    'Leverage: never, Olai is spot only',
    'One side per market: yes, no hedged pairs',
    `Wait between orders: ${rulebook.cooldownSecondsBetweenOrders} seconds`,
    `Trading hours: ${hours}`,
    `Owner approval needed above: ${usd(rulebook.requireApprovalAboveUsd)}`,
    `Data spending: ${usd(rulebook.maxDataSpendUsdPerDay)} a day, ${usd(rulebook.maxDataSpendUsdPerCall)} for any one call`,
  ].join('\n');
}

function staticSystemText(rulebook: Rulebook, dryRun: boolean): string {
  const mode = dryRun
    ? [
        'This session is a dry run. No order reaches Binance even after the owner approves,',
        'and buy_data prices a purchase with the wallet without signing it, so it comes back',
        'with a cost and no data. Work from the free reads and say in risks that the paid data',
        'was priced but not bought.',
      ].join(' ')
    : 'This session is live. buy_data spends the owner\'s real money and an approved order reaches the real market.';

  return [
    'You are Olai, an analyst working for one owner on their Binance account.',
    '',
    'Answer the owner\'s question with evidence, then call propose exactly once. You never place',
    'an order yourself. The owner approves or rejects every proposal, and the rulebook below is',
    'enforced in code before anything moves, whatever you say or think.',
    '',
    'How to work',
    '- Start with the free reads: read_ticker, read_order_book, read_klines, read_account.',
    '- Buy data only when the free reads cannot answer the question. search_bazaar finds paid',
    '  endpoints and buy_data pays one of them, a cent or two at a time.',
    '- Prefer the cheapest resource that answers the question. Never buy the same URL twice.',
    '- Prefer a listing that comes back with a request field. Those merchants are already proven,',
    '  and the field shows the exact method and an example body that works.',
    '- If buy_data says a merchant failed, try one more listing from search_bazaar. If that one',
    '  fails too, carry on without paid data and say so in risks.',
    '- If buy_data comes back refused, do not look for a way around it. Note it in risks and',
    '  work with what you have.',
    '- Finish by calling propose. In dataUsed, list every resource you actually bought with the',
    '  cost and the settlement transaction hash exactly as buy_data reported them. Never invent',
    '  a cost or a hash. If you bought nothing, dataUsed is an empty list.',
    '- Propose hold when the evidence is thin, when the question is not about a market in the',
    '  rulebook, or when the rulebook would refuse the trade. A weak trade is worse than none.',
    '- Keep summary to one or two sentences the owner can read on a phone. Put the argument in',
    '  reasoning and name what would make you wrong in risks.',
    '',
    renderRulebook(rulebook),
    '',
    'Write plainly and never use an em-dash character in anything you produce; use a full stop, a colon or commas instead.',
    'Anything outside the rulebook is refused by the code and the owner sees the refusal, so',
    'proposing it only wastes the owner\'s time.',
    '',
    mode,
  ].join('\n');
}

function volatileSystemText(rulebook: Rulebook, state: AccountState): string {
  const left = Math.max(0, rulebook.maxDataSpendUsdPerDay - state.dailyDataSpendUsd);
  const positions =
    state.openPositions.length > 0
      ? state.openPositions.map((p) => `${p.symbol} ${p.side} ${usd(p.usd)}`).join(', ')
      : 'none';

  return [
    'Where things stand right now',
    `- Time: ${state.nowIso}`,
    `- Data budget left today: ${usd(left)} of ${usd(rulebook.maxDataSpendUsdPerDay)}. A Bazaar call is usually about one cent.`,
    `- Most any single call may cost: ${usd(rulebook.maxDataSpendUsdPerCall)}`,
    `- Loss so far today: ${usd(state.dailyLossUsd)}`,
    `- Open positions: ${positions}`,
  ].join('\n');
}

/**
 * Runs one thinking session and returns the proposal it ended on.
 *
 * Writes a 'question' line to the ledger at the start and a 'proposal' line at
 * the end, plus one line for every read and every payment in between, so the
 * whole session can be replayed from the ledger alone.
 *
 * Throws NoProposalError when the model will not produce a proposal even after
 * being asked again, and AnalystRefusedError when the model declines the
 * question outright.
 */
export async function runAnalyst(
  question: string,
  deps: AnalystDeps,
): Promise<{ proposal: Proposal; transcript: Anthropic.Beta.BetaMessageParam[] }> {
  const { ledger, sessionId, rulebook } = deps;

  const emit = (event: BrainEvent): void => {
    try {
      deps.onEvent?.(event);
    } catch {
      // A listener that throws is the dashboard's problem, not the agent's.
      // Losing an event must never abandon a session that is spending money.
    }
  };

  const note = (summary: string, payload: Record<string, unknown>): void => {
    ledger.append({ kind: 'note', actor: 'binance', sessionId, payload: { summary, ...payload } });
  };

  ledger.append({
    kind: 'question',
    actor: 'owner',
    sessionId,
    payload: { question },
  });

  const openingState = await deps.accountState();
  const listedPrices = new Map<string, number>();
  const bought = new Set<string>();
  const failedUrls = new Set<string>();
  let spentThisSession = 0;
  let proposal: Proposal | undefined;

  const readTool = <Schema extends z.ZodType>(
    name: string,
    description: string,
    inputSchema: Schema,
    read: (input: z.infer<Schema>) => Promise<{ summary: string; result: unknown }>,
  ) =>
    betaZodTool({
      name,
      description,
      inputSchema,
      run: async (input) => {
        emit({ type: 'tool', name, input });
        try {
          const { summary, result } = await read(input);
          note(summary, { tool: name, input });
          emit({ type: 'tool.result', name, summary });
          return clip(JSON.stringify(result), MAX_DATA_CHARS);
        } catch (error) {
          const summary = `${name} failed: ${say(error)}`;
          note(summary, { tool: name, input, failed: true });
          emit({ type: 'tool.result', name, summary });
          return summary;
        }
      },
    });

  const searchBazaar = betaZodTool({
    name: 'search_bazaar',
    description:
      'Search Binance B402 Bazaar for paid data endpoints. Returns at most eight results that the Binance wallet can actually pay for, cheapest information first. Nothing is bought here and nothing is charged.',
    inputSchema: z.object({
      query: z.string().min(1).describe('Keywords, for example "BNB wallet flows" or "BTC quote"'),
      maxUsdPrice: z.number().positive().describe('The most you want to pay for one call, in US dollars'),
    }),
    run: async (input) => {
      emit({ type: 'tool', name: 'search_bazaar', input });
      // The model does not get to raise its own spending cap: whatever it asks
      // for is clamped to the rulebook before the search runs.
      const cap = Math.min(input.maxUsdPrice, rulebook.maxDataSpendUsdPerCall);

      try {
        const found = await deps.data.search({ query: input.query, maxUsdPrice: cap });
        const payable = found.filter(
          (resource) => resource.walletPayable && resource.priceUsd !== null,
        );

        // Merchants Olai has already paid go to the top of the list. The Bazaar
        // orders by its own relevance, which once left the one endpoint whose
        // request shape we know sitting below several we would have to guess at.
        const ordered = [
          ...payable.filter((resource) => hintFor(resource.url, {}) !== null),
          ...payable.filter((resource) => hintFor(resource.url, {}) === null),
        ].slice(0, MAX_SEARCH_RESULTS);

        for (const resource of ordered) {
          if (resource.priceUsd !== null) {
            listedPrices.set(resource.url, resource.priceUsd);
          }
        }

        const rows = ordered.map((resource) => {
          const hint = hintFor(resource.url, {});
          return {
            url: resource.url,
            description: clip(resource.description, MAX_DESCRIPTION_CHARS),
            priceUsd: resource.priceUsd,
            ...(hint === null ? {} : { request: describeRequest(hint) }),
          };
        });

        const summary = `Bazaar search "${input.query}" under ${usd(cap)}: ${rows.length} payable results`;
        ledger.append({
          kind: 'discovery',
          actor: 'agent',
          sessionId,
          payload: { summary, query: input.query, maxUsdPrice: cap, urls: rows.map((r) => r.url) },
        });
        emit({ type: 'tool.result', name: 'search_bazaar', summary });

        if (rows.length === 0) {
          return `No payable results for "${input.query}" under ${usd(cap)}.`;
        }
        return clip(JSON.stringify(rows), MAX_DATA_CHARS);
      } catch (error) {
        const summary = `Bazaar search failed: ${say(error)}`;
        note(summary, { tool: 'search_bazaar', input, failed: true });
        emit({ type: 'tool.result', name: 'search_bazaar', summary });
        return summary;
      }
    },
  });

  const buyData = betaZodTool({
    name: 'buy_data',
    description:
      'Pay one Bazaar merchant over x402 from the Binance Agentic Wallet and return what it sends back. This spends real money. The rulebook is checked first and the call is refused if it would break a rule.',
    inputSchema: z.object({
      url: z.string().describe('The exact resource URL from search_bazaar'),
      method: z.enum(['GET', 'POST']).optional(),
      body: z.record(z.string(), z.unknown()).optional().describe('JSON body for a POST'),
    }),
    run: async (input) => {
      emit({ type: 'tool', name: 'buy_data', input });

      if (bought.has(input.url)) {
        const summary = `Already bought ${input.url} in this session, not paying twice.`;
        note(summary, { tool: 'buy_data', url: input.url });
        emit({ type: 'tool.result', name: 'buy_data', summary });
        return summary;
      }

      if (!failedUrls.has(input.url) && failedUrls.size >= MAX_FAILED_MERCHANTS) {
        const summary = NO_PAID_DATA;
        note(summary, {
          tool: 'buy_data',
          url: input.url,
          refusedThirdMerchant: true,
          failedUrls: [...failedUrls],
        });
        emit({ type: 'tool.result', name: 'buy_data', summary });
        return summary;
      }

      const merchantFailed = (reason: string, payload: Record<string, unknown> = {}): string => {
        failedUrls.add(input.url);
        const advice = failedUrls.size >= MAX_FAILED_MERCHANTS ? NO_PAID_DATA : TRY_ONE_MORE;
        const summary = `this merchant failed: ${reason}. ${advice}`;
        note(summary, { tool: 'buy_data', url: input.url, failed: true, ...payload });
        emit({ type: 'tool.result', name: 'buy_data', summary });
        return summary;
      };

      // The listing says what a merchant sells, never what to send it. Where the
      // shape is known from a call that worked, fill in whatever the model left
      // out rather than letting an empty request come back HTTP 400.
      const hint = hintFor(input.url, requestContext(input));
      const useHint = hint !== null && (input.body === undefined || input.method === undefined);
      const request: BuyRequest = useHint
        ? { ...hint.example }
        : {
            url: input.url,
            method: input.method ?? 'GET',
            ...(input.body === undefined ? {} : { body: input.body }),
          };

      // With no listed price the ceiling is what the rulebook allows for one
      // call. Checking the worst case is the only safe way to check an unknown.
      const listed = listedPrices.get(input.url);
      const amountUsd = listed ?? rulebook.maxDataSpendUsdPerCall;

      // The rulebook check and the payment it allows are one step, because the
      // budget a second session is about to spend is not in the first session's
      // snapshot. Everything in here runs alone, however many sessions are open.
      const step = await withPaymentLock(async (): Promise<BuyStep> => {
        const state = await deps.accountState();
        const verdict = evaluate(
          rulebook,
          { type: 'payment', merchantUrl: input.url, amountUsd },
          { ...state, dailyDataSpendUsd: state.dailyDataSpendUsd + spentThisSession },
        );

        if (!verdict.allowed) {
          const summary = `The rulebook refused this purchase: ${verdict.reasons.join(' ')}`;
          ledger.append({
            kind: 'rule.refused',
            actor: 'rulebook',
            sessionId,
            payload: {
              summary,
              action: 'payment',
              merchantUrl: input.url,
              amountUsd,
              reasons: verdict.reasons,
              ruleIds: verdict.ruleIds,
            },
          });
          return { kind: 'refused', summary };
        }

        if (amountUsd > 0) {
          ledger.append({
            kind: 'payment.preview',
            actor: 'agent',
            sessionId,
            costUsd: amountUsd,
            payload: {
              summary: `About to pay up to ${usd(amountUsd)} for ${input.url}`,
              url: input.url,
              method: request.method ?? 'GET',
            },
          });
        } else {
          // A listing priced at nothing is not a payment, so there is no bill to
          // preview. The line still goes on the record that Olai called it.
          note(`free listing: ${input.url} is listed at no cost`, {
            tool: 'buy_data',
            url: input.url,
            freeListing: true,
          });
        }

        // Written next to the preview, not before the rulebook check, so a refused
        // purchase leaves no note about a request that never went out.
        if (useHint) {
          note(`Used the proven request for ${input.url}: ${hint.describe}`, {
            tool: 'buy_data',
            url: input.url,
            usedHint: true,
            method: request.method,
          });
        }

        try {
          // The rulebook has already judged the listed price. The buyer gets the
          // rulebook's own per-call ceiling, so a live quote a fraction of a cent
          // above the listing still pays instead of failing on its own price.
          return {
            kind: 'bought',
            outcome: await deps.data.buy(request, rulebook.maxDataSpendUsdPerCall),
          };
        } catch (error) {
          return { kind: 'failed', reason: `paying ${input.url} threw: ${say(error)}` };
        }
      });

      if (step.kind === 'refused') {
        emit({ type: 'tool.result', name: 'buy_data', summary: step.summary });
        return `REFUSED. ${step.summary} Do not try another way to buy this.`;
      }

      if (step.kind === 'failed') {
        return merchantFailed(step.reason);
      }

      const outcome = step.outcome;

      if (outcome.status === 'paid') {
        bought.add(input.url);
        spentThisSession += outcome.costUsd;
        // The data port wrote payment.settled as the payment came back, so there
        // is nothing to record here beyond telling the owner's screen about it.
        const summary = `Paid ${usd(outcome.costUsd)} to ${input.url}`;
        emit({ type: 'tool.result', name: 'buy_data', summary });
        return clip(
          JSON.stringify({
            url: input.url,
            costUsd: outcome.costUsd,
            txHash: outcome.txHash,
            data: outcome.data,
          }),
          MAX_DATA_CHARS,
        );
      }

      if (outcome.status === 'free') {
        bought.add(input.url);
        const summary = `${input.url} answered without asking for payment`;
        note(summary, { tool: 'buy_data', url: input.url });
        emit({ type: 'tool.result', name: 'buy_data', summary });
        return clip(
          JSON.stringify({ url: input.url, costUsd: 0, txHash: null, data: outcome.data }),
          MAX_DATA_CHARS,
        );
      }

      if (outcome.status === 'dry-run') {
        bought.add(input.url);
        const summary = `Dry run: ${input.url} would have cost ${usd(outcome.costUsd)}, nothing was signed`;
        note(summary, { tool: 'buy_data', url: input.url, dryRun: true });
        emit({ type: 'tool.result', name: 'buy_data', summary });
        return `${summary}. No data came back. Do not list this in dataUsed as if it were bought.`;
      }

      // A 4xx or 5xx from the merchant arrives here as a failed outcome, which is
      // the case that ended the live session: one bad request and no second try.
      if (outcome.status === 'failed') {
        return merchantFailed(outcome.reason, { status: outcome.status });
      }

      const summary = `The wallet refused to pay ${input.url}: ${outcome.reason}`;
      note(summary, { tool: 'buy_data', url: input.url, status: outcome.status });
      emit({ type: 'tool.result', name: 'buy_data', summary });
      return summary;
    },
  });

  const tools = [
    searchBazaar,
    buyData,
    readTool(
      'read_ticker',
      'Last price and the 24 hour move for one Binance symbol. Free.',
      z.object({ symbol: z.string().describe('For example BNBUSDT') }),
      async (input) => {
        const ticker = await deps.exchange.ticker(input.symbol);
        return {
          summary: `${ticker.symbol} at ${ticker.price}, ${ticker.change24hPct}% over 24 hours`,
          result: ticker,
        };
      },
    ),
    readTool(
      'read_order_book',
      'Top of the order book for one symbol, to see how thin the market is. Free.',
      z.object({
        symbol: z.string(),
        depth: z.number().int().min(1).max(20).optional(),
      }),
      async (input) => {
        const book = await deps.exchange.orderBook(
          input.symbol,
          ...(input.depth === undefined ? [] : ([input.depth] as const)),
        );
        const bestBid = book.bids[0]?.[0] ?? null;
        const bestAsk = book.asks[0]?.[0] ?? null;
        return {
          summary: `${book.symbol} book: best bid ${bestBid}, best ask ${bestAsk}`,
          result: book,
        };
      },
    ),
    readTool(
      'read_klines',
      'Recent candles for one symbol, for trend and volatility. Free.',
      z.object({
        symbol: z.string(),
        interval: z.string().describe('For example 1h or 1d'),
        limit: z.number().int().min(1).max(200).optional(),
      }),
      async (input) => {
        const candles = await deps.exchange.klines(
          input.symbol,
          input.interval,
          ...(input.limit === undefined ? [] : ([input.limit] as const)),
        );
        const first = candles[0];
        const last = candles[candles.length - 1];
        const move =
          first && last && first.o !== 0
            ? `${(((last.c - first.o) / first.o) * 100).toFixed(2)}%`
            : 'unknown';
        return {
          summary: `${input.symbol} ${input.interval}: ${candles.length} candles, ${move} across the window`,
          result: candles,
        };
      },
    ),
    readTool(
      'read_account',
      'Balances and open positions on the owner\'s Binance sub-account. Free.',
      z.object({}),
      async () => {
        const [balances, positions] = await Promise.all([
          deps.exchange.balances(),
          deps.exchange.positions(),
        ]);
        return {
          summary: `Account: ${balances.length} balances, ${positions.length} open positions`,
          result: { balances, positions },
        };
      },
    ),
    betaZodTool({
      name: 'propose',
      description:
        'End the session with one proposal for the owner. Call this exactly once, last. It records the proposal, it does not place anything.',
      inputSchema: proposalSchema,
      run: async (input) => {
        emit({ type: 'tool', name: 'propose', input });
        proposal = input;
        emit({ type: 'tool.result', name: 'propose', summary: input.summary });
        return 'recorded';
      },
    }),
  ];

  const system: Anthropic.Beta.BetaTextBlockParam[] = [
    {
      type: 'text',
      text: staticSystemText(rulebook, deps.dryRun),
      // The role and the rulebook are identical across every session that shares
      // a rulebook, so caching here pays for itself after the first question.
      // The block below carries the clock and the budget, which differ session
      // to session and would throw the cache away if they sat up here.
      cache_control: { type: 'ephemeral' },
    },
    {
      type: 'text',
      text: volatileSystemText(rulebook, openingState),
    },
  ];

  const iterate = async (
    messages: Anthropic.Beta.BetaMessageParam[],
    maxIterations: number,
  ): Promise<Anthropic.Beta.BetaMessageParam[]> => {
    const runner = deps.anthropic.beta.messages.toolRunner({
      model: deps.model ?? DEFAULT_MODEL,
      max_tokens: MAX_TOKENS,
      system,
      tools,
      messages,
      thinking: { type: 'adaptive', display: 'summarized' },
      output_config: { effort: 'high' },
      stream: true,
      max_iterations: maxIterations,
    });

    try {
      for await (const stream of runner) {
        stream.on('thinking', (delta) => emit({ type: 'thinking', text: delta }));
        stream.on('text', (delta) => emit({ type: 'text', text: delta }));

        const message = await stream.finalMessage();

        if (message.stop_reason === 'refusal') {
          throw new AnalystRefusedError(
            'Claude declined to answer this question. Nothing was proposed and nothing was spent.',
          );
        }

        // A paused turn is the server handing control back mid-answer. The tool
        // runner sends the turn straight back on the next pass; this line is
        // here so a long pause shows up in the audit trail instead of looking
        // like a hang.
        if (message.stop_reason === 'pause_turn') {
          note('Claude paused the turn and picked it back up', { stopReason: 'pause_turn' });
        }
      }

      await runner.done();
    } catch (error) {
      if (error instanceof Anthropic.RateLimitError) {
        note('Claude is rate limiting Olai, the session stopped early', { status: error.status });
      } else if (error instanceof Anthropic.APIError) {
        note(`Claude API error: ${error.message}`, { status: error.status });
      }
      throw error;
    }

    return [...runner.params.messages];
  };

  let transcript = await iterate([{ role: 'user', content: question }], MAX_ITERATIONS);

  if (!proposal) {
    // One nudge, then give up. A loop that keeps asking burns the owner's money
    // on tokens for a session that is already going nowhere.
    transcript = await iterate(
      [
        ...transcript,
        {
          role: 'user',
          content: 'You must end by calling propose. Do that now with what you already have.',
        },
      ],
      2,
    );
  }

  if (!proposal) {
    throw new NoProposalError(
      'The analyst finished twice without calling propose, so there is nothing for the owner to approve.',
    );
  }

  const decided: Proposal = proposal;
  ledger.append({
    kind: 'proposal',
    actor: 'agent',
    sessionId,
    payload: {
      summary: decided.summary,
      action: decided.action,
      confidence: decided.confidence,
      dataUsed: decided.dataUsed,
      risks: decided.risks,
      reasoning: decided.reasoning,
    },
  });
  emit({ type: 'proposal', proposal: decided });

  return { proposal: decided, transcript };
}
