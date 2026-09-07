import sample from "../../public/ledger-sample.json";
import type {
  LedgerActor,
  LedgerEntry,
  LedgerKind,
  OrderResult,
  Proposal,
  ProposedOrder,
  Rulebook,
  SessionRecord,
  Verdict,
} from "./api";
import { describe } from "./describe";
import type { BrainEvent } from "./sse";

/**
 * One recorded run of the desk, read back from the export the owner took off the
 * running service.
 *
 * A judge has no owner token, so the desk plays this instead of asking for one.
 * Everything here is read out of public/ledger-sample.json. Where the export does
 * not carry a field, the field is left off and the panels that would print it are
 * told not to. Nothing is filled in to make the screen look complete.
 */

interface RecordedRow {
  seq: number;
  ts: string;
  kind: string;
  actor: string;
  costUsd?: number;
  txHash?: string;
  hashPrefix: string;
  summary: string;
}

const rows: RecordedRow[] = sample;

/** A label, not a service id. The export carries no session id. */
export const RECORDED_SESSION_ID = "recorded-run";

/** How long each replayed line waits before the next one lands. */
export const REPLAY_STEP_MS = 700;

const questionRow = rows.find((row) => row.kind === "question");
const proposalRows = rows.filter((row) => row.kind === "proposal");
const settledRows = rows.filter((row) => row.kind === "payment.settled");
const sentRow = rows.find((row) => row.kind === "order.sent");
const filledRow = rows.find((row) => row.kind === "order.filled");
const approvalRow = rows.find((row) => row.kind === "approval");

/**
 * The export holds the first twelve characters of each line's hash, so that is
 * what the hash field carries and the table labels it a prefix. There is no
 * previous hash and no payload beyond the summary in the export.
 */
export const recordedEntries: LedgerEntry[] = rows.map((row) => ({
  seq: row.seq,
  ts: row.ts,
  kind: row.kind as LedgerKind,
  actor: row.actor as LedgerActor,
  payload: { summary: row.summary },
  ...(row.costUsd === undefined ? {} : { costUsd: row.costUsd }),
  ...(row.txHash === undefined ? {} : { txHash: row.txHash }),
  prevHash: "",
  hash: row.hashPrefix,
}));

export const recordedLines = recordedEntries.length;

/**
 * The same recorded lines, tagged with the label the replay uses for its one
 * session, so a screen that groups lines by session can read the recorded run
 * the way it reads a live one. The export carries no session id of its own.
 */
export const recordedSessionEntries: LedgerEntry[] = recordedEntries.map((entry) => ({
  ...entry,
  sessionId: RECORDED_SESSION_ID,
}));

/** The same shape the live feed carries, one event per recorded line. */
export const recordedStream: BrainEvent[] = rows.map((row) => ({
  type: "tool.result",
  name: row.kind,
  summary: row.summary,
}));

function recordedData(): Proposal["dataUsed"] {
  return settledRows.flatMap((row) => {
    const paid = /^Paid \$[0-9.]+ to (\S+)$/.exec(row.summary);
    if (!paid || row.costUsd === undefined) {
      return [];
    }
    return [{ url: paid[1], costUsd: row.costUsd, txHash: row.txHash ?? null }];
  });
}

/**
 * The side, the market and the size come out of the order.sent line. The order
 * type is not in the export, so it is left off and the card does not print it.
 */
function recordedAction(): ProposedOrder | undefined {
  const sent = sentRow ? /^Sent (BUY|SELL) ([A-Z0-9]+) for ([0-9.]+) USD$/.exec(sentRow.summary) : null;
  if (!sent) {
    return undefined;
  }
  const action: Omit<ProposedOrder, "orderType"> = {
    type: "order",
    symbol: sent[2],
    side: sent[1] as ProposedOrder["side"],
    quoteUsd: Number(sent[3]),
  };
  return action as ProposedOrder;
}

/** The fill line carries the status, the quantity and the cost. No order id. */
function recordedFill(): OrderResult | undefined {
  const fill = filledRow
    ? /^([A-Z_]+): ([0-9.]+) [A-Z0-9]+ for ([0-9.]+) USD$/.exec(filledRow.summary)
    : null;
  if (!fill) {
    return undefined;
  }
  const result: Omit<OrderResult, "orderId" | "avgPrice" | "raw"> = {
    status: fill[1] as OrderResult["status"],
    executedQty: Number(fill[2]),
    executedQuoteUsd: Number(fill[3]),
  };
  return result as OrderResult;
}

function recordedProposal(): Proposal | undefined {
  const action = recordedAction();
  if (!action || proposalRows.length === 0) {
    return undefined;
  }
  // Reasoning, confidence and the risk list are not in the export. The card is in
  // replay mode, where none of the three is printed.
  const proposal: Omit<Proposal, "reasoning" | "confidence" | "risks"> = {
    summary: proposalRows[0].summary,
    action,
    dataUsed: recordedData(),
  };
  return proposal as Proposal;
}

/**
 * What the rulebook said, in the words of the line that recorded it. The export
 * does not carry the rule ids or the size ceiling that was in force, so the card
 * shows the sentence and nothing else.
 */
function recordedVerdict(): Verdict | undefined {
  const line = proposalRows[1];
  if (!line) {
    return undefined;
  }
  const verdict: Omit<Verdict, "effectiveMaxOrderUsd"> = {
    allowed: true,
    requiresApproval: approvalRow !== undefined,
    reasons: [line.summary],
    ruleIds: [],
  };
  return verdict as Verdict;
}

const fill = recordedFill();
const proposal = recordedProposal();
const verdict = recordedVerdict();

export const recordedSession: SessionRecord = {
  id: RECORDED_SESSION_ID,
  question: questionRow?.summary ?? "",
  createdAt: questionRow?.ts ?? rows[0]?.ts ?? "",
  status: fill ? "executed" : approvalRow ? "approved" : "pending",
  ...(proposal ? { proposal } : {}),
  ...(verdict ? { verdict } : {}),
  ...(fill ? { orderResult: fill } : {}),
};

/**
 * The fill as a sentence, for the control that replaced Approve. It goes through
 * the same reader the thread uses, so the owner is never shown the raw line the
 * venue wrote.
 */
const filledEntry = recordedEntries.find((entry) => entry.kind === "order.filled");
export const recordedFillSentence = filledEntry ? describe(filledEntry).sentence : "";

/**
 * The rulebook a fresh install runs under, copied from the agent's
 * defaultRulebook in packages/agent/src/rulebook/store.ts. These are product
 * defaults, not a reading of the recorded run.
 */
export const replayRulebook: Rulebook = {
  version: 1,
  name: "Olai starter rulebook",
  maxOrderUsd: 20,
  maxDailyLossUsd: 10,
  maxPositionUsdPerSymbol: 50,
  allowedSymbols: ["BNBUSDT", "BTCUSDT", "ETHUSDT"],
  allowShort: false,
  allowLeverage: false,
  maxDataSpendUsdPerDay: 1,
  maxDataSpendUsdPerCall: 0.05,
  cooldownSecondsBetweenOrders: 60,
  requireApprovalAboveUsd: 0,
  oneSidePerMarket: true,
  drawdownTiers: [
    { lossUsd: 5, action: "halve" },
    { lossUsd: 10, action: "halt" },
  ],
};
