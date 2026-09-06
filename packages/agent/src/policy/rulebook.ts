import { z } from 'zod';
import { MAX_USD } from './money.js';

/**
 * The rulebook is the contract between the owner and the agent. It is written
 * once, stored in the ledger, and checked in code before anything moves. The
 * model never gets to decide whether a rule applies.
 */
export interface Rulebook {
  version: 1;
  name: string;
  maxOrderUsd: number;
  maxDailyLossUsd: number;
  maxPositionUsdPerSymbol: number;
  allowedSymbols: string[];
  allowShort: boolean;
  allowLeverage: false;
  maxDataSpendUsdPerDay: number;
  maxDataSpendUsdPerCall: number;
  cooldownSecondsBetweenOrders: number;
  tradingHoursUtc?: { start: number; end: number };
  requireApprovalAboveUsd: number;
  oneSidePerMarket: true;
  drawdownTiers: Array<{ lossUsd: number; action: 'halve' | 'halt' }>;
}

// Amounts arrive from a form and from JSON, so they are checked as money here
// rather than trusted: real number, not negative, no more than two decimals,
// and inside a range where cents still fit in a safe integer.
const usd = z
  .number()
  .min(0, 'cannot be negative')
  .max(MAX_USD, `cannot be more than ${MAX_USD} dollars`)
  .refine(
    (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6,
    'must be a dollar amount with at most two decimal places',
  );

const symbol = z
  .string()
  .regex(/^[A-Z0-9]{4,20}$/, 'must be an uppercase Binance symbol such as BNBUSDT');

const hour = z.number().int().min(0).max(23);

const baseRulebook = z.object({
  version: z.literal(1),
  name: z.string().trim().min(1, 'give the rulebook a name').max(80),
  maxOrderUsd: usd,
  maxDailyLossUsd: usd,
  maxPositionUsdPerSymbol: usd,
  allowedSymbols: z.array(symbol).max(50, 'a rulebook with more than 50 markets is not a rulebook'),
  allowShort: z.boolean(),
  // Olai is a spot agent. Leverage is not a setting the owner can turn on,
  // it is a capability the product does not have.
  allowLeverage: z.literal(false),
  maxDataSpendUsdPerDay: usd,
  maxDataSpendUsdPerCall: usd,
  cooldownSecondsBetweenOrders: z.number().int().min(0).max(86_400),
  tradingHoursUtc: z
    .object({ start: hour, end: hour })
    .refine(
      (window) => window.start !== window.end,
      'start and end cannot be the same hour, that window has no meaning. Leave tradingHoursUtc out to trade around the clock',
    )
    .optional(),
  requireApprovalAboveUsd: usd,
  oneSidePerMarket: z.literal(true),
  drawdownTiers: z
    .array(z.object({ lossUsd: usd, action: z.enum(['halve', 'halt']) }))
    .max(10, 'ten drawdown tiers is already more than anyone can reason about'),
});

/**
 * The rulebook shape, exported so the web app validates exactly what the agent
 * enforces. Parsing is the only supported way to build a Rulebook.
 */
export const rulebookSchema: z.ZodType<Rulebook> = baseRulebook.refine(
  (book) => book.maxDataSpendUsdPerCall <= book.maxDataSpendUsdPerDay,
  {
    path: ['maxDataSpendUsdPerCall'],
    error: 'a single data call cannot be allowed to cost more than the whole day budget',
  },
);
