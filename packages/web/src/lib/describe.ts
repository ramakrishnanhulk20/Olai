import type { LedgerEntry } from "./api";
import { bscscan, host, qty, usd } from "./format";

/**
 * The ledger, read back as sentences a person would say.
 *
 * Every sentence is built from the entry it describes and nothing else. Where a
 * line does not carry the field a sentence would need, the sentence gets
 * shorter rather than invented, and a line whose payload says nothing useful
 * falls back to the summary the agent wrote when it recorded it.
 *
 * The recorded run in public/ledger-sample.json carries a summary and no other
 * payload field, so the fallbacks here are what the replay reads from.
 */

export type Tone = "neutral" | "money" | "rule" | "owner" | "binance";

export interface Described {
  sentence: string;
  detail?: string;
  href?: string;
  tone: Tone;
}

/** Notes the account writes about itself. True in the receipt, noise in a conversation. */
const QUIET_NOTES = new Set(["equity.day_start", "positions.unpriced"]);

function field(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function number(payload: Record<string, unknown>, key: string): number | undefined {
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function summaryOf(entry: LedgerEntry): string {
  return field(entry.payload, "summary") ?? entry.kind;
}

/** Fractions of a cent are money too, so a price under a cent keeps its digits. */
function price(amount: number | undefined): string {
  if (amount === undefined) {
    return "";
  }
  return amount > 0 && amount < 0.01 ? `$${amount.toFixed(4)}` : usd(amount);
}

function merchant(entry: LedgerEntry): string | undefined {
  const url = field(entry.payload, "url") ?? field(entry.payload, "merchantUrl");
  if (url) {
    return host(url);
  }
  const found = /https?:\/\/\S+/.exec(summaryOf(entry));
  return found ? host(found[0].replace(/[.,]$/, "")) : undefined;
}

/** The side and the market, from the recorded action or from the words of the line. */
function order(entry: LedgerEntry): { side: string; symbol: string } | undefined {
  const action = entry.payload["action"];
  if (action && typeof action === "object") {
    const shape = action as { side?: unknown; symbol?: unknown };
    if (typeof shape.side === "string" && typeof shape.symbol === "string") {
      return { side: shape.side, symbol: shape.symbol };
    }
  }
  const found = /\b(BUY|SELL)\s+([A-Z0-9]{4,})\b/.exec(summaryOf(entry));
  return found ? { side: found[1], symbol: found[2] } : undefined;
}

function reasons(entry: LedgerEntry): string {
  const list = entry.payload["reasons"];
  if (Array.isArray(list)) {
    const lines = list.filter((line): line is string => typeof line === "string");
    if (lines.length > 0) {
      return lines.join(" ");
    }
  }
  const summary = summaryOf(entry);
  const colon = summary.indexOf(": ");
  return colon === -1 ? summary : summary.slice(colon + 2);
}

function verb(side: string): string {
  return side === "SELL" ? "sell" : "buy";
}

/** What the ledger line is under the sentence, for the owner who wants the raw thing. */
function detailOf(entry: LedgerEntry): string {
  const head = `line ${entry.seq} · ${entry.kind} · ${entry.actor} · hash ${entry.hash.slice(0, 12)}`;
  return `${head}\n${JSON.stringify(entry.payload, null, 2)}`;
}

/** False for the lines the account writes about itself, which belong in the receipt only. */
export function inConversation(entry: LedgerEntry): boolean {
  if (entry.kind !== "note") {
    return true;
  }
  const kind = field(entry.payload, "kind");
  return kind === undefined || !QUIET_NOTES.has(kind);
}

export function describe(entry: LedgerEntry): Described {
  const detail = detailOf(entry);
  const summary = summaryOf(entry);
  const cost = entry.costUsd;

  switch (entry.kind) {
    case "question": {
      const asked = field(entry.payload, "question") ?? summary;
      return { sentence: `You asked: ${asked}`, detail, tone: "owner" };
    }

    case "note": {
      const kind = field(entry.payload, "kind");
      if (kind === "equity.day_start") {
        const equity = number(entry.payload, "equityUsd");
        return {
          sentence:
            equity === undefined
              ? `Olai noted where the account started the day: ${summary}`
              : `Olai noted the account started the day at ${usd(equity)}`,
          detail,
          tone: "neutral",
        };
      }
      if (kind === "positions.unpriced") {
        return { sentence: `Olai left unpriced holdings out: ${summary}`, detail, tone: "neutral" };
      }
      // Every note the analyst writes is filed under the venue, whether it came
      // from reading a market or from shopping for data, so the tool that wrote
      // it is what says which sentence it gets. A note with no tool at all is
      // either a recorded market read or something about the model itself.
      const tool = field(entry.payload, "tool");
      const aboutTheModel = "stopReason" in entry.payload || "status" in entry.payload;

      if (entry.actor === "binance" && tool === undefined && !aboutTheModel) {
        return { sentence: `Olai read the market: ${summary}`, detail, tone: "binance" };
      }
      if (tool !== undefined && tool.startsWith("read_")) {
        return { sentence: `Olai read the market: ${summary}`, detail, tone: "binance" };
      }
      if (tool === "buy_data" || tool === "search_bazaar") {
        return { sentence: `Olai noted: ${summary}`, detail, tone: "money" };
      }
      return { sentence: `Olai noted: ${summary}`, detail, tone: "neutral" };
    }

    case "discovery": {
      const query = field(entry.payload, "query");
      const urls = entry.payload["urls"];
      const cap = number(entry.payload, "maxUsdPrice");
      if (query && Array.isArray(urls)) {
        const count = urls.length;
        const under = cap === undefined ? "" : ` under ${price(cap)}`;
        return {
          sentence: `Olai searched the Bazaar for ${query}: ${count} ${count === 1 ? "listing" : "listings"}${under}`,
          detail,
          tone: "money",
        };
      }
      return { sentence: `Olai searched the Bazaar: ${summary}`, detail, tone: "money" };
    }

    case "payment.preview": {
      const where = merchant(entry);
      const amount = price(cost ?? number(entry.payload, "amountUsd"));
      if (amount === "") {
        return { sentence: `Olai priced a data call: ${summary}`, detail, tone: "money" };
      }
      return {
        sentence: `Olai priced a data call at ${amount}${where ? ` from ${where}` : ""}`,
        detail,
        tone: "money",
      };
    }

    case "payment.signed": {
      const where = merchant(entry);
      const amount = price(cost);
      if (amount === "") {
        return { sentence: `Olai paid for data: ${summary}`, detail, tone: "money" };
      }
      return {
        sentence: `Olai paid ${where ?? "the merchant"} ${amount} from the wallet`,
        detail,
        tone: "money",
      };
    }

    case "payment.settled": {
      const where = merchant(entry);
      const amount = price(cost);
      const sentence = `Settled on BNB Smart Chain${where ? `, ${where} was paid` : ""}${amount === "" ? "" : ` ${amount}`}`;
      return {
        sentence,
        detail,
        ...(entry.txHash ? { href: bscscan(entry.txHash) } : {}),
        tone: "money",
      };
    }

    case "data.received":
      return { sentence: "The data arrived", detail, tone: "money" };

    case "proposal": {
      if (entry.payload["hold"] === true) {
        return { sentence: "Olai recommends holding. Nothing to approve.", detail, tone: "neutral" };
      }
      return { sentence: `Olai proposes: ${summary}`, detail, tone: "neutral" };
    }

    case "rule.refused":
      return { sentence: `The rulebook refused: ${reasons(entry)}`, detail, tone: "rule" };

    case "approval": {
      const action = order(entry);
      return {
        sentence: action
          ? `You approved the ${verb(action.side)} of ${action.symbol}`
          : `You approved the proposal`,
        detail,
        tone: "owner",
      };
    }

    case "rejection": {
      const reason = field(entry.payload, "reason");
      return {
        sentence: reason
          ? `You rejected the proposal: ${reason}`
          : "You rejected the proposal",
        detail,
        tone: "owner",
      };
    }

    case "order.sent": {
      const dryRun = entry.payload["dryRun"] === true || summary.startsWith("Dry run");
      return {
        sentence: dryRun ? "Dry run: the order was not sent" : "Olai sent the order to Binance",
        detail,
        tone: "binance",
      };
    }

    case "order.filled": {
      const result = entry.payload["result"] as
        | { executedQty?: unknown; executedQuoteUsd?: unknown; avgPrice?: unknown }
        | undefined;
      const found = /([0-9]*\.?[0-9]+)\s+([A-Z0-9]{4,})\s+for\s+([0-9]*\.?[0-9]+)/.exec(summary);
      const filled =
        typeof result?.executedQty === "number" ? qty(result.executedQty) : (found?.[1] ?? "");
      const symbol = found?.[2] ?? "";
      const average = typeof result?.avgPrice === "number" ? result.avgPrice : null;
      const spent =
        typeof result?.executedQuoteUsd === "number"
          ? result.executedQuoteUsd
          : found
            ? Number(found[3])
            : undefined;

      if (filled === "") {
        return { sentence: `Binance filled the order: ${summary}`, detail, tone: "binance" };
      }
      const what = `${filled}${symbol === "" ? "" : ` ${symbol}`}`;
      if (average !== null) {
        return { sentence: `Binance filled ${what} at ${usd(average)}`, detail, tone: "binance" };
      }
      return {
        sentence: `Binance filled ${what}${spent === undefined ? "" : ` for ${usd(spent)}`}`,
        detail,
        tone: "binance",
      };
    }

    case "order.failed": {
      const colon = summary.indexOf(": ");
      const why = colon === -1 ? summary : summary.slice(colon + 2);
      return { sentence: `The order did not go through: ${why}`, detail, tone: "binance" };
    }

    case "kill":
      return { sentence: "You stopped Olai", detail, tone: "owner" };

    case "resume":
      return { sentence: "You resumed Olai", detail, tone: "owner" };

    case "rulebook.set": {
      const book = entry.payload["rulebook"] as { name?: unknown } | undefined;
      const named =
        typeof book?.name === "string" ? book.name : (/"([^"]+)"/.exec(summary)?.[1] ?? null);
      return {
        sentence: named === null ? `Rulebook saved: ${summary}` : `Rulebook saved: ${named}`,
        detail,
        tone: "rule",
      };
    }

    default:
      return { sentence: `Olai noted: ${summary}`, detail, tone: "neutral" };
  }
}
