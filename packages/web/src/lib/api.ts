/**
 * The owner API, typed.
 *
 * Every shape here mirrors packages/agent/src, and every call carries the owner
 * bearer token. Failures come back as one error type that already knows what
 * the owner should do about it.
 */

export const API_BASE = process.env.NEXT_PUBLIC_OLAI_API ?? "http://localhost:4000";

export type LedgerKind =
  | "rulebook.set"
  | "question"
  | "discovery"
  | "payment.preview"
  | "payment.signed"
  | "payment.settled"
  | "data.received"
  | "proposal"
  | "approval"
  | "rejection"
  | "order.sent"
  | "order.filled"
  | "order.failed"
  | "rule.refused"
  | "kill"
  | "resume"
  | "note";

export type LedgerActor = "owner" | "agent" | "rulebook" | "binance" | "merchant" | "system";

export interface LedgerEntry {
  seq: number;
  ts: string;
  kind: LedgerKind;
  actor: LedgerActor;
  payload: Record<string, unknown>;
  costUsd?: number;
  txHash?: string;
  orderId?: string;
  sessionId?: string;
  prevHash: string;
  hash: string;
}

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
  drawdownTiers: Array<{ lossUsd: number; action: "halve" | "halt" }>;
}

export interface ProposedOrder {
  type: "order";
  symbol: string;
  side: "BUY" | "SELL";
  quoteUsd: number;
  orderType: "MARKET" | "LIMIT";
  limitPrice?: number;
}

export type ProposalAction = ProposedOrder | { type: "hold"; reason: string };

export interface Proposal {
  summary: string;
  reasoning: string;
  action: ProposalAction;
  confidence: number;
  dataUsed: Array<{ url: string; costUsd: number; txHash: string | null }>;
  risks: string[];
}

export interface Verdict {
  allowed: boolean;
  requiresApproval: boolean;
  effectiveMaxOrderUsd: number;
  reasons: string[];
  ruleIds: string[];
}

export interface OrderResult {
  orderId: string;
  status: "FILLED" | "PARTIALLY_FILLED" | "NEW" | "REJECTED" | "CANCELED";
  executedQty: number;
  executedQuoteUsd: number;
  avgPrice: number | null;
  raw: unknown;
}

export type ProposalStatus =
  | "pending"
  | "refused"
  | "approved"
  | "rejected"
  | "executed"
  | "failed";

export interface SessionRecord {
  id: string;
  question: string;
  createdAt: string;
  proposal?: Proposal;
  verdict?: Verdict;
  status: ProposalStatus;
  orderResult?: OrderResult;
}

export interface Health {
  ok: boolean;
  dryRun: boolean;
  killed: boolean;
  version: string;
}

export interface AccountState {
  nowIso: string;
  killed: boolean;
  dailyLossUsd: number;
  dailyDataSpendUsd: number;
  openPositions: Array<{ symbol: string; side: "LONG" | "SHORT"; usd: number }>;
  lastOrderAtIso?: string;
}

export interface WalletSettings {
  x402DailyLimit: number;
  x402QuotaUsed: number;
  x402QuotaLeft: number;
  dailyLimit: number;
  abnormalTxnHandling: string;
}

export interface WalletBalance {
  binanceChainId: string;
  tokenSymbol: string;
  tokenAddress: string;
  balance: string;
  balanceUsd: string;
}

export interface WalletState {
  status: string;
  settings: WalletSettings | null;
  balances: WalletBalance[];
}

export type ChainCheck =
  | { ok: true; length: number }
  | { ok: false; brokenAtSeq: number; reason: string };

export interface LedgerPage {
  entries: LedgerEntry[];
  nextAfterSeq: number | null;
}

/** One field the agent refused, in the shape zod hands back. */
export interface ApiIssue {
  path: Array<string | number>;
  message: string;
  code?: string;
}

/** Every failure the desk shows, already carrying the sentence that says what to do. */
export class OlaiError extends Error {
  readonly status: number;
  readonly nextStep: string;
  readonly issues: ApiIssue[];

  constructor(status: number, message: string, nextStep: string, issues: ApiIssue[] = []) {
    super(message);
    this.name = "OlaiError";
    this.status = status;
    this.nextStep = nextStep;
    this.issues = issues;
  }

  /** True when the token was refused, which is the one failure that clears the gate. */
  get unauthorized(): boolean {
    return this.status === 401;
  }
}

function where(): string {
  try {
    return new URL(API_BASE).host;
  } catch {
    return API_BASE;
  }
}

export function offline(): OlaiError {
  return new OlaiError(
    0,
    `The service is not answering at ${where()}.`,
    "Start it with npm run dev -w @olai/agent, then try again.",
  );
}

function nextStepFor(status: number): string {
  switch (status) {
    case 400:
      return "Fix the field marked below and send it again.";
    case 401:
      return "Check OLAI_OWNER_TOKEN in .env.";
    case 404:
      return "Reload the desk, the service does not have that session any more.";
    case 409:
      return "This one has already been answered. Ask Olai a fresh question.";
    case 413:
      return "Shorten what you sent and try again.";
    case 429:
      return "Olai allows sixty calls a minute. Wait a moment, then try again.";
    case 502:
      return "Olai could not reach Binance or its wallet. Check the keys in .env and the agent log.";
    case 503:
      return "That part of Olai is not configured. Check .env and the agent log.";
    default:
      return "Look at the agent log for the detail, then try again.";
  }
}

interface Call {
  method?: "GET" | "POST" | "PUT";
  token: string;
  body?: unknown;
  signal?: AbortSignal;
  query?: Record<string, string | number | undefined>;
}

async function call<T>(path: string, opts: Call): Promise<T> {
  if (opts.token.trim() === "") {
    throw new OlaiError(401, "That token is not the owner's.", nextStepFor(401));
  }

  const url = new URL(path, `${API_BASE}/`);
  for (const [key, value] of Object.entries(opts.query ?? {})) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }

  const headers: Record<string, string> = { Authorization: `Bearer ${opts.token}` };
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: opts.method ?? "GET",
      headers,
      ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    throw offline();
  }

  return read<T>(response);
}

async function read<T>(response: Response): Promise<T> {
  const text = await response.text();
  let parsed: unknown;
  if (text.trim() !== "") {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
  }

  if (response.ok) {
    return parsed as T;
  }

  const body = (parsed ?? {}) as { error?: string; issues?: ApiIssue[] };
  const message =
    response.status === 401
      ? "That token is not the owner's."
      : (body.error ?? `Olai answered ${response.status}.`);

  throw new OlaiError(
    response.status,
    message,
    nextStepFor(response.status),
    Array.isArray(body.issues) ? body.issues : [],
  );
}

/** The one public route. It is how the desk knows the service is alive at all. */
export async function getHealth(signal?: AbortSignal): Promise<Health> {
  let response: Response;
  try {
    response = await fetch(new URL("health", `${API_BASE}/`), signal ? { signal } : {});
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    throw offline();
  }
  return read<Health>(response);
}

export const getRulebook = (token: string, signal?: AbortSignal) =>
  call<Rulebook>("api/rulebook", { token, ...(signal ? { signal } : {}) });

export const putRulebook = (token: string, rulebook: Rulebook) =>
  call<Rulebook>("api/rulebook", { token, method: "PUT", body: rulebook });

export const ask = (token: string, question: string, signal?: AbortSignal) =>
  call<SessionRecord>("api/ask", {
    token,
    method: "POST",
    body: { question },
    ...(signal ? { signal } : {}),
  });

export const listSessions = (token: string, signal?: AbortSignal) =>
  call<SessionRecord[]>("api/sessions", { token, ...(signal ? { signal } : {}) });

export const getSession = (token: string, id: string) =>
  call<SessionRecord>(`api/sessions/${encodeURIComponent(id)}`, { token });

export const approveSession = (token: string, id: string) =>
  call<SessionRecord>(`api/sessions/${encodeURIComponent(id)}/approve`, { token, method: "POST" });

export const rejectSession = (token: string, id: string, reason: string) =>
  call<SessionRecord>(`api/sessions/${encodeURIComponent(id)}/reject`, {
    token,
    method: "POST",
    body: { reason },
  });

export const kill = (token: string) => call<{ killed: true }>("api/kill", { token, method: "POST" });

export const resume = (token: string) =>
  call<{ killed: false }>("api/resume", { token, method: "POST" });

export const getLedgerPage = (
  token: string,
  opts: { afterSeq?: number; limit?: number; kinds?: string; sessionId?: string } = {},
  signal?: AbortSignal,
) =>
  call<LedgerPage>("api/ledger", {
    token,
    query: {
      afterSeq: opts.afterSeq,
      limit: opts.limit ?? 500,
      kinds: opts.kinds,
      sessionId: opts.sessionId,
    },
    ...(signal ? { signal } : {}),
  });

export const verifyLedger = (token: string) => call<ChainCheck>("api/ledger/verify", { token });

export const getAccount = (token: string, signal?: AbortSignal) =>
  call<AccountState>("api/account", { token, ...(signal ? { signal } : {}) });

export const getWallet = (token: string, signal?: AbortSignal) =>
  call<WalletState>("api/wallet", { token, ...(signal ? { signal } : {}) });

/**
 * Ledger lines after a sequence number, oldest first.
 *
 * The API pages forward from a sequence number, so the desk walks the pages
 * rather than guessing a window. The page cap keeps a long-running ledger from
 * pulling the browser under on first load.
 */
export async function getLedgerSince(
  token: string,
  afterSeq: number | undefined,
  signal?: AbortSignal,
  maxPages = 20,
): Promise<LedgerEntry[]> {
  const entries: LedgerEntry[] = [];
  let cursor = afterSeq;

  for (let page = 0; page < maxPages; page += 1) {
    const result = await getLedgerPage(
      token,
      { ...(cursor === undefined ? {} : { afterSeq: cursor }), limit: 500 },
      signal,
    );
    entries.push(...result.entries);
    if (result.nextAfterSeq === null) {
      break;
    }
    cursor = result.nextAfterSeq;
  }

  return entries;
}

export function say(error: unknown): { message: string; nextStep: string; issues: ApiIssue[] } {
  if (error instanceof OlaiError) {
    return { message: error.message, nextStep: error.nextStep, issues: error.issues };
  }
  return {
    message: error instanceof Error ? error.message : String(error),
    nextStep: "Reload the desk. If it happens again, look at the agent log.",
    issues: [],
  };
}
