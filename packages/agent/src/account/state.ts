import type { Ledger } from '../ledger/ledger.js';
import type { AccountState } from '../policy/engine.js';
import { toCents, toUsd } from '../policy/money.js';
import type { Balance, ExchangePort } from '../ports/exchange.js';

/**
 * The account as the rulebook has to see it.
 *
 * The rulebook engine is a pure function, so somebody has to go and find out
 * what is actually true right now: what is held, what was spent on data today,
 * when the last order went out, and how far down the day is. That is this file,
 * and it is the only place those four numbers are worked out.
 *
 * Everything is measured in whole cents. A daily loss limit that is a cent out
 * is a limit that fires on the wrong trade.
 */

/** Olai could not work out where the account stands, so no rule can be checked. */
export class AccountStateError extends Error {
  override name = 'AccountStateError';
}

/** Balances in these assets are cash, not a position Olai has taken. */
const DEFAULT_QUOTE_ASSETS = ['USDT', 'USDC', 'FDUSD', 'BUSD'];

/**
 * Under a dollar a holding is dust left over from a fill, not a position. Left
 * in, it would make every market look occupied and the one-side-per-market rule
 * would refuse trades the owner expects to work. A whole dollar is a position:
 * it is the smallest amount the owner could have meant to buy.
 */
const POSITION_DUST_USD = 1;

const DAY_START_NOTE = 'equity.day_start';

export class AccountStateSource {
  private readonly exchange: ExchangePort;
  private readonly ledger: Ledger;
  private readonly quoteAssets: Set<string>;
  private readonly quoteSymbol: string;
  private readonly now: () => Date;

  constructor(opts: {
    exchange: ExchangePort;
    ledger: Ledger;
    quoteAssets?: string[];
    now?: () => Date;
  }) {
    const quotes = (opts.quoteAssets ?? DEFAULT_QUOTE_ASSETS)
      .map((asset) => asset.trim().toUpperCase())
      .filter((asset) => asset !== '');

    // Positions are named the way the rulebook names markets, so a BNB holding
    // has to become BNBUSDT. The first quote asset is the one that pairs.
    const [pairsWith] = quotes;
    if (pairsWith === undefined) {
      throw new AccountStateError('at least one quote asset is needed to read the account');
    }

    this.exchange = opts.exchange;
    this.ledger = opts.ledger;
    this.quoteAssets = new Set(quotes);
    this.quoteSymbol = pairsWith;
    this.now = opts.now ?? (() => new Date());
  }

  /**
   * Reads the account and the ledger into one snapshot the engine can check.
   *
   * The first call on a new UTC day also records what the account was worth at
   * the start of that day, as a ledger note. Every later call that day measures
   * the loss against that same recorded number, so the daily loss limit cannot
   * be reset by restarting the agent.
   *
   * killed is always false here. The session runner lays its own kill switch
   * over the top, so a stale read can never un-stop a stopped agent.
   *
   * Throws AccountStateError when the exchange or the ledger will not answer.
   */
  async snapshot(): Promise<AccountState> {
    const now = this.now();
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
      throw new AccountStateError('the clock handed back a time I cannot read');
    }

    const nowIso = now.toISOString();
    const date = nowIso.slice(0, 10);
    const dayStartIso = `${date}T00:00:00.000Z`;

    let balances: Balance[];
    try {
      balances = await this.exchange.balances();
    } catch (error) {
      throw new AccountStateError(
        `the exchange would not say what is in the account: ${say(error)}`,
      );
    }

    if (!Array.isArray(balances)) {
      throw new AccountStateError('the exchange answered with something that is not a balance list');
    }

    try {
      // Signatures, not settlements. The money is committed the moment the
      // wallet signs, whether or not the merchant ever answers, and the settled
      // line carries the same cost again, so counting both would double it.
      const dailyDataSpendUsd = money(
        this.ledger.sumCostUsd({ sinceIso: dayStartIso, kinds: ['payment.signed'] }),
      );

      this.noteUnpriced(balances);
      const equityCents = this.equityCents(balances);
      const dayStartCents = this.dayStartEquityCents(date, equityCents);
      const dailyLossUsd = toUsd(Math.max(0, dayStartCents - equityCents));

      const state: AccountState = {
        nowIso,
        killed: false,
        dailyLossUsd,
        dailyDataSpendUsd,
        openPositions: this.positions(balances),
      };

      const lastOrderAtIso = this.lastOrderAtIso();
      if (lastOrderAtIso !== undefined) {
        state.lastOrderAtIso = lastOrderAtIso;
      }

      return state;
    } catch (error) {
      if (error instanceof AccountStateError) {
        throw error;
      }
      throw new AccountStateError(`the ledger would not answer: ${say(error)}`);
    }
  }

  /**
   * Spot has no shorts, so anything held that is not cash is a long. A holding
   * Olai cannot price in dollars is left out rather than counted as zero,
   * because a position of unknown size is not a position the rules can measure.
   */
  private positions(balances: Balance[]): AccountState['openPositions'] {
    const positions: AccountState['openPositions'] = [];

    for (const balance of balances) {
      const asset = String(balance?.asset ?? '').trim().toUpperCase();
      if (asset === '' || this.quoteAssets.has(asset)) {
        continue;
      }

      const usdValue = balance.usdValue;
      if (typeof usdValue !== 'number' || !Number.isFinite(usdValue) || usdValue < POSITION_DUST_USD) {
        continue;
      }

      positions.push({
        symbol: `${asset}${this.quoteSymbol}`,
        side: 'LONG',
        usd: money(usdValue),
      });
    }

    return positions;
  }

  /**
   * Says out loud which holdings the venue would not price.
   *
   * A holding with no price is left out of the positions and out of the equity,
   * so without this line it would be money the owner holds that no screen and no
   * rule can see. The note does not change any number, it only makes the gap
   * visible in the record.
   */
  private noteUnpriced(balances: Balance[]): void {
    const assets: string[] = [];

    for (const balance of balances) {
      const asset = String(balance?.asset ?? '').trim().toUpperCase();
      if (asset === '' || this.quoteAssets.has(asset)) {
        continue;
      }
      const usdValue = balance.usdValue;
      if (typeof usdValue !== 'number' || !Number.isFinite(usdValue)) {
        assets.push(asset);
      }
    }

    if (assets.length === 0) {
      return;
    }

    this.ledger.append({
      kind: 'note',
      actor: 'system',
      payload: {
        summary: `Binance would not price ${assets.join(', ')}, so ${assets.length === 1 ? 'it is' : 'they are'} left out of the account value and out of the open positions`,
        kind: 'positions.unpriced',
        assets,
      },
    });
  }

  private equityCents(balances: Balance[]): number {
    let cents = 0;

    for (const balance of balances) {
      const usdValue = balance?.usdValue;
      if (typeof usdValue === 'number' && Number.isFinite(usdValue)) {
        cents += toCents(usdValue);
        continue;
      }

      // Cash the venue did not bother to price is worth its face value. A
      // non-cash holding with no price is skipped, since guessing it at face
      // value would price a coin as if it were a dollar.
      const asset = String(balance?.asset ?? '').trim().toUpperCase();
      if (!this.quoteAssets.has(asset)) {
        continue;
      }

      const free = Number.isFinite(balance.free) ? balance.free : 0;
      const locked = Number.isFinite(balance.locked) ? balance.locked : 0;
      cents += toCents(free + locked);
    }

    return cents;
  }

  /**
   * Today's opening equity, written down the first time it is needed.
   *
   * The read and the write happen without an await between them, so two
   * snapshots taken in the same tick cannot both decide the note is missing.
   */
  private dayStartEquityCents(date: string, equityCents: number): number {
    let recorded: number | undefined;

    for (const entry of this.ledger.list({ kinds: ['note'] })) {
      const payload = entry.payload;
      if (
        payload.kind === DAY_START_NOTE &&
        payload.date === date &&
        typeof payload.equityUsd === 'number' &&
        Number.isFinite(payload.equityUsd)
      ) {
        recorded = toCents(payload.equityUsd);
      }
    }

    if (recorded !== undefined) {
      return recorded;
    }

    const equityUsd = toUsd(equityCents);
    this.ledger.append({
      kind: 'note',
      actor: 'system',
      payload: {
        summary: `The account was worth ${equityUsd.toFixed(2)} US dollars at the start of ${date} UTC`,
        kind: DAY_START_NOTE,
        date,
        equityUsd,
      },
    });

    return equityCents;
  }

  /**
   * When the last order went out, dry run or not. A dry run still starts the
   * cooldown: the demo should behave exactly like the live agent, or the demo
   * is not showing the product.
   */
  private lastOrderAtIso(): string | undefined {
    const sent = this.ledger.list({ kinds: ['order.sent'] });
    return sent.length === 0 ? undefined : sent[sent.length - 1]?.ts;
  }
}

/** Rounds to whole cents and refuses anything that is not real money. */
function money(value: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new AccountStateError(`expected a dollar amount, got ${String(value)}`);
  }
  return toUsd(toCents(value));
}

function say(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
