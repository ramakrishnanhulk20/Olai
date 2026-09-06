import { z } from 'zod';
import type { ProposedAction } from '../policy/engine.js';

/**
 * The one thing a thinking session is allowed to produce.
 *
 * The model can write anything it likes in its own words, but the only output
 * that leaves the brain is this object, and it only leaves after it parses.
 * That is what keeps the model on the advice side of the line: a proposal is a
 * request for the owner's approval, never an instruction to the exchange.
 */
export const proposalSchema = z.object({
  summary: z.string(),
  reasoning: z.string(),
  action: z.discriminatedUnion('type', [
    z.object({
      type: z.literal('order'),
      symbol: z.string(),
      side: z.enum(['BUY', 'SELL']),
      quoteUsd: z.number(),
      orderType: z.enum(['MARKET', 'LIMIT']),
      limitPrice: z.number().optional(),
    }),
    z.object({
      type: z.literal('hold'),
      reason: z.string(),
    }),
  ]),
  confidence: z.number().min(0).max(1),
  dataUsed: z.array(
    z.object({
      url: z.string(),
      costUsd: z.number(),
      txHash: z.string().nullable(),
    }),
  ),
  risks: z.array(z.string()),
});

export type Proposal = z.infer<typeof proposalSchema>;

export type ProposedOrder = Extract<Proposal['action'], { type: 'order' }>;

/**
 * Turns a proposed order into the action shape the rulebook engine checks.
 *
 * Order type and limit price are left out on purpose: the rulebook governs what
 * may be traded and how much, not how the order is worked at the venue.
 */
export function toProposedAction(order: ProposedOrder): ProposedAction {
  return {
    type: 'order',
    symbol: order.symbol,
    side: order.side,
    quoteUsd: order.quoteUsd,
  };
}
