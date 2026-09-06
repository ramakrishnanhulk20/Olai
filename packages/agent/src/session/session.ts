import { randomUUID } from 'node:crypto';
import type Anthropic from '@anthropic-ai/sdk';
import { type BrainEvent, runAnalyst } from '../brain/analyst.js';
import { type Proposal, toProposedAction } from '../brain/proposal.js';
import type { Ledger } from '../ledger/ledger.js';
import { type AccountState, type Verdict, evaluate } from '../policy/engine.js';
import type { Rulebook } from '../policy/rulebook.js';
import type { DataPort } from '../ports/data.js';
import type { ExchangePort, OrderResult } from '../ports/exchange.js';

/**
 * One question, from asking to filling.
 *
 * The runner is the only thing that can move money, and it is deliberately dull:
 * it asks the brain for a proposal, checks it against the rulebook, waits for
 * the owner, checks the rulebook again because the account may have moved while
 * the owner was thinking, and only then sends one order.
 *
 * Records live in memory. The ledger is the durable record, so a restart loses
 * the pending list but never loses what happened.
 */

export type ProposalStatus =
  | 'pending'
  | 'refused'
  | 'approved'
  | 'rejected'
  | 'executed'
  | 'failed';

export interface SessionRecord {
  id: string;
  question: string;
  createdAt: string;
  proposal?: Proposal;
  verdict?: Verdict;
  status: ProposalStatus;
  orderResult?: OrderResult;
}

export interface SessionRunnerDeps {
  exchange: ExchangePort;
  data: DataPort;
  ledger: Ledger;
  /**
   * The rules in force. Pass a function to have them read again at every use,
   * which is how an edit through the API reaches the next question and the next
   * approval without a restart.
   */
  rulebook: Rulebook | (() => Rulebook);
  anthropic: Anthropic;
  dryRun: boolean;
  onEvent?: (sessionId: string, e: BrainEvent) => void;
  accountState: () => Promise<AccountState>;
}

export class SessionNotFoundError extends Error {
  override name = 'SessionNotFoundError';
}

/** The caller asked something the runner cannot start a session from. */
export class SessionInputError extends Error {
  override name = 'SessionInputError';
}

/** The owner acted on a session that is not waiting for an answer any more. */
export class SessionNotPendingError extends Error {
  override name = 'SessionNotPendingError';
}

export class SessionRunner {
  private readonly deps: SessionRunnerDeps;
  private readonly sessions = new Map<string, SessionRecord>();
  /**
   * Sessions that have already reached placeOrder.
   *
   * A session is added before the order is sent, not after. If the send throws
   * we do not know whether the venue got it, and a second attempt could buy
   * twice. One order per session, even a failed one, is the safe reading.
   */
  private readonly ordered = new Set<string>();
  /**
   * Approvals in flight, keyed by session. The rulebook re-check awaits an account
   * read, and two clicks arriving inside that wait must not both reach placeOrder,
   * so the second caller is handed the first caller's promise instead of a new run.
   */
  private readonly approving = new Map<string, Promise<SessionRecord>>();
  /**
   * One approval at a time, across every session.
   *
   * The rulebook re-check reads the account and then the order is sent, and
   * those are two steps. Two different sessions approved together would both
   * read the account as it was before either order, so both would pass a
   * position limit that only has room for one of them. Queueing makes the check
   * and the order one step that nothing else gets between.
   */
  private orderQueue: Promise<unknown> = Promise.resolve();
  private killed = false;

  constructor(deps: SessionRunnerDeps) {
    this.deps = deps;
  }

  /**
   * Asks Olai a question and runs the analyst to a proposal.
   *
   * A hold needs no rulebook check and comes back approved with nothing to do.
   * An order is checked against the rulebook straight away, so a proposal the
   * rules forbid is refused before the owner is ever asked about it.
   */
  async ask(question: string): Promise<SessionRecord> {
    const text = question.trim();
    if (text === '') {
      throw new SessionInputError('a session needs a question');
    }

    const id = `ol-${randomUUID().replace(/-/g, '')}`;
    const record: SessionRecord = {
      id,
      question: text,
      createdAt: new Date().toISOString(),
      status: 'pending',
    };
    this.sessions.set(id, record);

    const { proposal } = await runAnalyst(text, {
      anthropic: this.deps.anthropic,
      exchange: this.deps.exchange,
      data: this.deps.data,
      ledger: this.deps.ledger,
      rulebook: this.rulebook,
      accountState: () => this.state(),
      sessionId: id,
      dryRun: this.deps.dryRun,
      ...(this.deps.onEvent ? { onEvent: (event: BrainEvent) => this.emit(id, event) } : {}),
    });

    record.proposal = proposal;

    if (proposal.action.type === 'hold') {
      record.status = 'approved';
      this.deps.ledger.append({
        kind: 'proposal',
        actor: 'agent',
        sessionId: id,
        payload: { summary: 'Olai proposes holding, so there is nothing to approve', hold: true },
      });
      return { ...record };
    }

    const verdict = evaluate(this.rulebook, toProposedAction(proposal.action), await this.state());
    record.verdict = verdict;

    if (!verdict.allowed) {
      record.status = 'refused';
      this.deps.ledger.append({
        kind: 'rule.refused',
        actor: 'rulebook',
        sessionId: id,
        payload: {
          summary: `The rulebook refused this proposal: ${verdict.reasons.join(' ')}`,
          action: proposal.action,
          reasons: verdict.reasons,
          ruleIds: verdict.ruleIds,
        },
      });
      return { ...record };
    }

    this.deps.ledger.append({
      kind: 'proposal',
      actor: 'agent',
      sessionId: id,
      payload: {
        summary: 'Proposal passed the rulebook and is waiting for the owner',
        action: proposal.action,
        ruleIds: verdict.ruleIds,
      },
    });

    return { ...record };
  }

  /**
   * The owner says yes.
   *
   * The rulebook is checked again here against a fresh account snapshot, since
   * the day's loss, the open positions and the kill switch can all have changed
   * while the proposal sat waiting. Approving twice sends one order, not two.
   */
  async approve(sessionId: string): Promise<SessionRecord> {
    const inFlight = this.approving.get(sessionId);
    if (inFlight) {
      return inFlight;
    }
    const run = this.queued(() => this.approveOnce(sessionId)).finally(() =>
      this.approving.delete(sessionId),
    );
    this.approving.set(sessionId, run);
    return run;
  }

  /** Runs fn after every approval already in the queue, whatever happened to them. */
  private queued<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.orderQueue.then(fn, fn);
    // The queue's own copy swallows the failure so one bad approval cannot
    // block every later one. The caller still gets the rejection.
    this.orderQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async approveOnce(sessionId: string): Promise<SessionRecord> {
    const record = this.mustFind(sessionId);

    if (record.status === 'executed' || this.ordered.has(sessionId)) {
      return { ...record };
    }
    if (record.status !== 'pending') {
      throw new SessionNotPendingError(
        `session ${sessionId} is ${record.status}, so it cannot be approved`,
      );
    }

    const proposal = record.proposal;
    if (!proposal || proposal.action.type !== 'order') {
      throw new SessionNotPendingError(`session ${sessionId} has no order to approve`);
    }
    const order = proposal.action;

    const verdict = evaluate(this.rulebook, toProposedAction(order), await this.state());
    record.verdict = verdict;

    // Refusals here are about the account right now (killed, cooldown, hours, the
    // day's loss), not about the proposal, so the session stays pending and the
    // owner can approve again once the condition clears, or reject it.
    if (!verdict.allowed) {
      this.deps.ledger.append({
        kind: 'rule.refused',
        actor: 'rulebook',
        sessionId,
        payload: {
          summary: `The rulebook refused this order at approval time: ${verdict.reasons.join(' ')}`,
          action: order,
          reasons: verdict.reasons,
          ruleIds: verdict.ruleIds,
        },
      });
      return { ...record };
    }

    this.deps.ledger.append({
      kind: 'approval',
      actor: 'owner',
      sessionId,
      payload: { summary: `Owner approved ${order.side} ${order.symbol}`, action: order },
    });

    if (this.deps.dryRun) {
      this.ordered.add(sessionId);
      record.status = 'executed';
      this.deps.ledger.append({
        kind: 'order.sent',
        actor: 'agent',
        sessionId,
        orderId: sessionId,
        payload: {
          summary: `Dry run: ${order.side} ${order.symbol} for ${order.quoteUsd} USD was not sent to Binance`,
          dryRun: true,
          action: order,
        },
      });
      return { ...record };
    }

    this.ordered.add(sessionId);
    this.deps.ledger.append({
      kind: 'order.sent',
      actor: 'agent',
      sessionId,
      orderId: sessionId,
      payload: {
        summary: `Sent ${order.side} ${order.symbol} for ${order.quoteUsd} USD`,
        dryRun: false,
        action: order,
      },
    });

    let result: OrderResult;
    try {
      result = await this.deps.exchange.placeOrder({
        symbol: order.symbol,
        side: order.side,
        type: order.orderType,
        quoteUsd: order.quoteUsd,
        ...(order.limitPrice === undefined ? {} : { limitPrice: order.limitPrice }),
        clientOrderId: sessionId,
      });
    } catch (error) {
      record.status = 'failed';
      this.deps.ledger.append({
        kind: 'order.failed',
        actor: 'binance',
        sessionId,
        orderId: sessionId,
        payload: {
          summary: `The order did not go through: ${error instanceof Error ? error.message : String(error)}`,
          action: order,
        },
      });
      return { ...record };
    }

    record.orderResult = result;

    if (result.status === 'REJECTED' || result.status === 'CANCELED') {
      record.status = 'failed';
      this.deps.ledger.append({
        kind: 'order.failed',
        actor: 'binance',
        sessionId,
        orderId: result.orderId,
        payload: { summary: `Binance came back ${result.status}`, result },
      });
      return { ...record };
    }

    record.status = 'executed';
    this.deps.ledger.append({
      kind: 'order.filled',
      actor: 'binance',
      sessionId,
      orderId: result.orderId,
      payload: {
        summary: `${result.status}: ${result.executedQty} ${order.symbol} for ${result.executedQuoteUsd} USD`,
        result,
      },
    });

    return { ...record };
  }

  /** The owner says no. Nothing is sent and the reason goes on the record. */
  async reject(sessionId: string, reason: string): Promise<SessionRecord> {
    const record = this.mustFind(sessionId);

    if (record.status !== 'pending') {
      throw new SessionNotPendingError(
        `session ${sessionId} is ${record.status}, so it cannot be rejected`,
      );
    }

    record.status = 'rejected';
    this.deps.ledger.append({
      kind: 'rejection',
      actor: 'owner',
      sessionId,
      payload: { summary: 'Owner rejected the proposal', reason },
    });

    return { ...record };
  }

  /**
   * The stop button.
   *
   * It does not try to cancel anything in flight. It flips the account snapshot
   * to killed, and the rulebook engine refuses every order and every payment
   * that is checked after that, which is every one of them.
   */
  kill(): void {
    if (this.killed) {
      return;
    }
    this.killed = true;
    this.deps.ledger.append({
      kind: 'kill',
      actor: 'owner',
      payload: { summary: 'Owner hit the kill switch, Olai is stopped' },
    });
  }

  /** Clears the stop button. Nothing that was refused while killed is retried. */
  resume(): void {
    if (!this.killed) {
      return;
    }
    this.killed = false;
    this.deps.ledger.append({
      kind: 'resume',
      actor: 'owner',
      payload: { summary: 'Owner resumed Olai' },
    });
  }

  get isKilled(): boolean {
    return this.killed;
  }

  get(sessionId: string): SessionRecord | undefined {
    const record = this.sessions.get(sessionId);
    return record ? { ...record } : undefined;
  }

  list(): SessionRecord[] {
    return [...this.sessions.values()].map((record) => ({ ...record }));
  }

  private emit(sessionId: string, event: BrainEvent): void {
    this.deps.onEvent?.(sessionId, event);
  }

  private mustFind(sessionId: string): SessionRecord {
    const record = this.sessions.get(sessionId);
    if (!record) {
      throw new SessionNotFoundError(`no session ${sessionId}`);
    }
    return record;
  }

  /**
   * The account as the rulebook should see it. The local kill switch wins over
   * whatever the snapshot says, so hitting stop cannot be undone by a stale read.
   */
  /**
   * The rulebook as it stands right now. Every use goes through here, so an
   * approval is always checked against the rules on disk at that moment, not
   * the ones that were in force when the question was asked.
   */
  private get rulebook(): Rulebook {
    const source = this.deps.rulebook;
    return typeof source === 'function' ? source() : source;
  }

  private async state(): Promise<AccountState> {
    const state = await this.deps.accountState();
    return { ...state, killed: state.killed || this.killed };
  }
}
