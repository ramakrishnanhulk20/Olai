import { formatUsd, isCleanUsd, toCents, toUsd } from './money.js';
import type { Rulebook } from './rulebook.js';

export type ProposedAction =
  | { type: 'order'; symbol: string; side: 'BUY' | 'SELL'; quoteUsd: number; leverage?: number }
  | { type: 'payment'; merchantUrl: string; amountUsd: number };

export interface AccountState {
  nowIso: string;
  killed: boolean;
  dailyLossUsd: number;
  dailyDataSpendUsd: number;
  openPositions: Array<{ symbol: string; side: 'LONG' | 'SHORT'; usd: number }>;
  lastOrderAtIso?: string;
}

export interface Verdict {
  allowed: boolean;
  requiresApproval: boolean;
  effectiveMaxOrderUsd: number;
  reasons: string[];
  ruleIds: string[];
}

/**
 * Every rule has a fixed id. The id is what the ledger records and what the
 * dashboard looks up, so these strings are part of the product and do not
 * change once they ship.
 */
export const ruleIds = {
  killed: 'agent.killed',
  rulebookInvalid: 'input.rulebook_invalid',
  stateInvalid: 'input.state_invalid',
  amountInvalid: 'input.amount_invalid',
  maxOrder: 'order.max_size',
  symbolNotAllowed: 'order.symbol_not_allowed',
  shortNotAllowed: 'order.short_not_allowed',
  leverageNotAllowed: 'order.leverage_not_allowed',
  maxPosition: 'order.max_position',
  oneSidePerMarket: 'order.one_side_per_market',
  cooldown: 'order.cooldown',
  tradingHours: 'order.trading_hours',
  needsApproval: 'order.needs_approval',
  dailyLoss: 'risk.daily_loss_reached',
  drawdownHalve: 'risk.drawdown_halve',
  drawdownHalt: 'risk.drawdown_halt',
  paymentPerCall: 'payment.max_per_call',
  paymentDailyBudget: 'payment.daily_budget',
} as const;

interface Hit {
  ruleId: string;
  reason: string;
  refuses: boolean;
}

/**
 * Checks one proposed action against the rulebook and the account as it stands.
 *
 * This is a pure function: same rulebook, same action, same state, same verdict,
 * every time. It reads no clock and no database, which is what lets the ledger
 * replay any past decision and get the same answer.
 *
 * It never throws. Nonsense inputs (NaN, Infinity, negative money, an
 * unreadable timestamp) come back as a refusal, because an agent that crashes
 * on bad input is an agent whose rules can be skipped by sending bad input.
 */
export function evaluate(rulebook: Rulebook, action: ProposedAction, state: AccountState): Verdict {
  const hits: Hit[] = [];

  if (!rulebookLooksReal(rulebook)) {
    return verdict(
      [
        {
          ruleId: ruleIds.rulebookInvalid,
          reason: 'The rulebook itself is not valid, so nothing is allowed until it is fixed.',
          refuses: true,
        },
      ],
      0,
      false,
    );
  }

  if (state === null || typeof state !== 'object' || state.killed === true) {
    return verdict(
      [
        {
          ruleId: ruleIds.killed,
          reason:
            'Olai is stopped. The kill switch is on, so no orders and no payments go out until the owner resumes it.',
          refuses: true,
        },
      ],
      0,
      false,
    );
  }

  const now = readIso(state.nowIso);
  if (now === undefined || !stateLooksReal(state)) {
    return verdict(
      [
        {
          ruleId: ruleIds.stateInvalid,
          reason:
            'The account snapshot is unreadable (bad timestamp or bad numbers), so no action is allowed on it.',
          refuses: true,
        },
      ],
      0,
      false,
    );
  }

  // Risk hits belong to trading, not to buying data. A halted day still lets
  // Olai answer questions; it is the data budget that governs those.
  const riskHits: Hit[] = [];
  const dailyLossCents = toCents(state.dailyLossUsd);
  const maxDailyLossCents = toCents(rulebook.maxDailyLossUsd);

  let effectiveCents = toCents(rulebook.maxOrderUsd);
  let tradingStopped = false;

  if (dailyLossCents >= maxDailyLossCents) {
    tradingStopped = true;
    riskHits.push({
      ruleId: ruleIds.dailyLoss,
      reason: `Today's loss is ${formatUsd(state.dailyLossUsd)} and the rulebook stops trading at ${formatUsd(rulebook.maxDailyLossUsd)}. Trading is done for the day.`,
      refuses: true,
    });
  }

  // Tiers are applied in the order the owner wrote them, so two halve tiers in
  // a row cut the size to a quarter. That is deliberate: the owner is asking
  // for size to keep shrinking as the day gets worse.
  for (const tier of rulebook.drawdownTiers) {
    if (!isCleanUsd(tier.lossUsd) || dailyLossCents < toCents(tier.lossUsd)) {
      continue;
    }

    if (tier.action === 'halt') {
      tradingStopped = true;
      riskHits.push({
        ruleId: ruleIds.drawdownHalt,
        reason: `Today's loss passed the ${formatUsd(tier.lossUsd)} drawdown tier, and that tier says halt.`,
        refuses: true,
      });
      continue;
    }

    effectiveCents = Math.floor(effectiveCents / 2);
    riskHits.push({
      ruleId: ruleIds.drawdownHalve,
      reason: `Today's loss passed the ${formatUsd(tier.lossUsd)} drawdown tier, so the biggest single order is halved to ${formatUsd(toUsd(effectiveCents))}.`,
      refuses: false,
    });
  }

  if (tradingStopped) {
    effectiveCents = 0;
  }

  const effectiveMaxOrderUsd = toUsd(effectiveCents);

  if (action === null || typeof action !== 'object') {
    hits.push({
      ruleId: ruleIds.stateInvalid,
      reason: 'There is no action to check.',
      refuses: true,
    });
    return verdict(hits, effectiveMaxOrderUsd, false);
  }

  if (action.type === 'payment') {
    checkPayment(rulebook, action, state, hits);
    return verdict(hits, effectiveMaxOrderUsd, false);
  }

  if (action.type !== 'order') {
    hits.push({
      ruleId: ruleIds.stateInvalid,
      reason: 'That is not an action Olai knows how to check.',
      refuses: true,
    });
    return verdict(hits, effectiveMaxOrderUsd, false);
  }

  hits.push(...riskHits);
  const requiresApproval = checkOrder(rulebook, action, state, now, effectiveCents, hits);
  return verdict(hits, effectiveMaxOrderUsd, requiresApproval);
}

function checkOrder(
  rulebook: Rulebook,
  action: Extract<ProposedAction, { type: 'order' }>,
  state: AccountState,
  now: Date,
  effectiveCents: number,
  hits: Hit[],
): boolean {
  if (!isCleanUsd(action.quoteUsd) || action.quoteUsd <= 0) {
    hits.push({
      ruleId: ruleIds.amountInvalid,
      reason: 'The order size has to be a real amount in dollars, above zero.',
      refuses: true,
    });
    return false;
  }

  if (typeof action.symbol !== 'string' || action.symbol.trim() === '') {
    hits.push({
      ruleId: ruleIds.symbolNotAllowed,
      reason: 'The order does not name a market.',
      refuses: true,
    });
    return false;
  }

  if (action.side !== 'BUY' && action.side !== 'SELL') {
    hits.push({
      ruleId: ruleIds.amountInvalid,
      reason: 'An order is either a BUY or a SELL.',
      refuses: true,
    });
    return false;
  }

  const symbol = action.symbol.trim().toUpperCase();
  const quoteCents = toCents(action.quoteUsd);

  if (!rulebook.allowedSymbols.some((allowed) => allowed.toUpperCase() === symbol)) {
    const list =
      rulebook.allowedSymbols.length === 0
        ? 'no markets at all'
        : rulebook.allowedSymbols.join(', ');
    hits.push({
      ruleId: ruleIds.symbolNotAllowed,
      reason: `${symbol} is not in the rulebook. It allows ${list}.`,
      refuses: true,
    });
  }

  if (action.leverage !== undefined && !(Number.isFinite(action.leverage) && action.leverage <= 1)) {
    hits.push({
      ruleId: ruleIds.leverageNotAllowed,
      reason: 'Olai trades spot only. Any leverage above 1 is refused.',
      refuses: true,
    });
  }

  if (quoteCents > effectiveCents) {
    hits.push({
      ruleId: ruleIds.maxOrder,
      reason: `This order is ${formatUsd(action.quoteUsd)} and the most Olai may send right now is ${formatUsd(toUsd(effectiveCents))}.`,
      refuses: true,
    });
  }

  if (rulebook.tradingHoursUtc !== undefined) {
    const window = rulebook.tradingHoursUtc;
    if (!withinHours(now.getUTCHours(), window)) {
      hits.push({
        ruleId: ruleIds.tradingHours,
        reason: `The rulebook only trades between ${pad(window.start)}:00 and ${pad(window.end)}:00 UTC, and it is ${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())} UTC.`,
        refuses: true,
      });
    }
  }

  const cooldownHit = checkCooldown(rulebook, state, now);
  if (cooldownHit !== undefined) {
    hits.push(cooldownHit);
  }

  const netCents = netPositionCents(state, symbol);
  const resultingCents = action.side === 'BUY' ? netCents + quoteCents : netCents - quoteCents;

  if (!rulebook.allowShort && action.side === 'SELL' && netCents <= 0) {
    hits.push({
      ruleId: ruleIds.shortNotAllowed,
      reason: `The rulebook does not allow shorting, and there is nothing long in ${symbol} to sell.`,
      refuses: true,
    });
  }

  if (rulebook.oneSidePerMarket) {
    if (action.side === 'BUY' && netCents < 0) {
      hits.push({
        ruleId: ruleIds.oneSidePerMarket,
        reason: `There is already a short open in ${symbol}. One side per market: close it before buying.`,
        refuses: true,
      });
    }

    if (action.side === 'SELL' && netCents > 0 && resultingCents < 0) {
      hits.push({
        ruleId: ruleIds.oneSidePerMarket,
        reason: `This sell is bigger than the long in ${symbol} and would flip it short. One side per market: sell at most ${formatUsd(toUsd(netCents))}.`,
        refuses: true,
      });
    }
  }

  const maxPositionCents = toCents(rulebook.maxPositionUsdPerSymbol);
  if (Math.abs(resultingCents) > maxPositionCents) {
    hits.push({
      ruleId: ruleIds.maxPosition,
      reason: `This would leave ${formatUsd(toUsd(Math.abs(resultingCents)))} in ${symbol}, and the rulebook caps one market at ${formatUsd(rulebook.maxPositionUsdPerSymbol)}.`,
      refuses: true,
    });
  }

  if (quoteCents > toCents(rulebook.requireApprovalAboveUsd)) {
    hits.push({
      ruleId: ruleIds.needsApproval,
      reason: `This order is above ${formatUsd(rulebook.requireApprovalAboveUsd)}, so the owner has to approve it.`,
      refuses: false,
    });
    return true;
  }

  return false;
}

function checkPayment(
  rulebook: Rulebook,
  action: Extract<ProposedAction, { type: 'payment' }>,
  state: AccountState,
  hits: Hit[],
): void {
  // Zero is allowed here, unlike an order: a merchant that lists a call at no
  // cost is a free read, and refusing it would send Olai looking for a paid
  // one instead. Anything negative or unreadable is still refused.
  if (!isCleanUsd(action.amountUsd)) {
    hits.push({
      ruleId: ruleIds.amountInvalid,
      reason: 'The data payment has to be a real amount in dollars, and never a negative one.',
      refuses: true,
    });
    return;
  }

  if (typeof action.merchantUrl !== 'string' || action.merchantUrl.trim() === '') {
    hits.push({
      ruleId: ruleIds.amountInvalid,
      reason: 'The payment does not say which merchant it is for.',
      refuses: true,
    });
    return;
  }

  const amountCents = toCents(action.amountUsd);
  const perCallCents = toCents(rulebook.maxDataSpendUsdPerCall);
  const spentCents = toCents(state.dailyDataSpendUsd);
  const dailyCents = toCents(rulebook.maxDataSpendUsdPerDay);

  if (amountCents > perCallCents) {
    hits.push({
      ruleId: ruleIds.paymentPerCall,
      reason: `This data call costs ${formatUsd(action.amountUsd)} and the rulebook caps one call at ${formatUsd(rulebook.maxDataSpendUsdPerCall)}.`,
      refuses: true,
    });
  }

  if (spentCents + amountCents > dailyCents) {
    hits.push({
      ruleId: ruleIds.paymentDailyBudget,
      reason: `Olai has spent ${formatUsd(state.dailyDataSpendUsd)} on data today. Paying ${formatUsd(action.amountUsd)} would pass the ${formatUsd(rulebook.maxDataSpendUsdPerDay)} daily budget.`,
      refuses: true,
    });
  }
}

function checkCooldown(rulebook: Rulebook, state: AccountState, now: Date): Hit | undefined {
  if (rulebook.cooldownSecondsBetweenOrders <= 0 || state.lastOrderAtIso === undefined) {
    return undefined;
  }

  const last = readIso(state.lastOrderAtIso);
  if (last === undefined) {
    return {
      ruleId: ruleIds.cooldown,
      reason: 'The time of the last order is unreadable, so the cooldown is treated as still running.',
      refuses: true,
    };
  }

  const elapsedSeconds = (now.getTime() - last.getTime()) / 1000;
  if (elapsedSeconds >= rulebook.cooldownSecondsBetweenOrders) {
    return undefined;
  }

  // A last order stamped in the future means a clock problem somewhere, and
  // the safe reading of a clock problem is to wait, not to trade.
  const waitSeconds = Math.max(0, Math.ceil(rulebook.cooldownSecondsBetweenOrders - elapsedSeconds));
  return {
    ruleId: ruleIds.cooldown,
    reason: `The rulebook waits ${rulebook.cooldownSecondsBetweenOrders} seconds between orders. ${waitSeconds} seconds left.`,
    refuses: true,
  };
}

/** LONG counts up, SHORT counts down, so a market nets out to one number. */
function netPositionCents(state: AccountState, symbol: string): number {
  let net = 0;
  for (const position of state.openPositions) {
    if (position.symbol.trim().toUpperCase() !== symbol) {
      continue;
    }
    const cents = toCents(position.usd);
    net += position.side === 'SHORT' ? -cents : cents;
  }
  return net;
}

function withinHours(hourOfDay: number, window: { start: number; end: number }): boolean {
  // A window like 22 to 4 runs across midnight, so the test flips from "between
  // the two" to "outside the two".
  return window.start < window.end
    ? hourOfDay >= window.start && hourOfDay < window.end
    : hourOfDay >= window.start || hourOfDay < window.end;
}

function readIso(value: unknown): Date | undefined {
  if (typeof value !== 'string' || value.trim() === '') {
    return undefined;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function rulebookLooksReal(rulebook: Rulebook): boolean {
  return (
    rulebook !== null &&
    typeof rulebook === 'object' &&
    isCleanUsd(rulebook.maxOrderUsd) &&
    isCleanUsd(rulebook.maxDailyLossUsd) &&
    isCleanUsd(rulebook.maxPositionUsdPerSymbol) &&
    isCleanUsd(rulebook.maxDataSpendUsdPerDay) &&
    isCleanUsd(rulebook.maxDataSpendUsdPerCall) &&
    isCleanUsd(rulebook.requireApprovalAboveUsd) &&
    Number.isFinite(rulebook.cooldownSecondsBetweenOrders) &&
    Array.isArray(rulebook.allowedSymbols) &&
    Array.isArray(rulebook.drawdownTiers) &&
    (rulebook.tradingHoursUtc === undefined ||
      (Number.isInteger(rulebook.tradingHoursUtc.start) &&
        Number.isInteger(rulebook.tradingHoursUtc.end)))
  );
}

function stateLooksReal(state: AccountState): boolean {
  return (
    isCleanUsd(state.dailyLossUsd) &&
    isCleanUsd(state.dailyDataSpendUsd) &&
    Array.isArray(state.openPositions) &&
    state.openPositions.every(
      (position) =>
        position !== null &&
        typeof position === 'object' &&
        typeof position.symbol === 'string' &&
        (position.side === 'LONG' || position.side === 'SHORT') &&
        isCleanUsd(position.usd),
    )
  );
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function verdict(hits: Hit[], effectiveMaxOrderUsd: number, requiresApproval: boolean): Verdict {
  return {
    allowed: !hits.some((hit) => hit.refuses),
    requiresApproval,
    effectiveMaxOrderUsd,
    reasons: hits.map((hit) => hit.reason),
    ruleIds: hits.map((hit) => hit.ruleId),
  };
}
