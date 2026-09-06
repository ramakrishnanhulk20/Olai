"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  OlaiError,
  say,
  verifyLedger,
  type ChainCheck,
  type LedgerEntry,
  type LedgerKind,
} from "@/lib/api";
import { bscscan, clockTime, shortHash, usd } from "@/lib/format";

/**
 * The record, newest first.
 *
 * Every line is hashed onto the one before it, so the verify button is not
 * decoration: it recomputes the whole chain on the service and names the first
 * line that does not match.
 */

const GROUPS: Array<{ id: string; label: string; kinds: LedgerKind[] | null }> = [
  { id: "all", label: "Everything", kinds: null },
  {
    id: "payments",
    label: "Payments",
    kinds: ["discovery", "payment.preview", "payment.signed", "payment.settled", "data.received"],
  },
  {
    id: "orders",
    label: "Orders",
    kinds: ["proposal", "approval", "rejection", "order.sent", "order.filled", "order.failed"],
  },
  { id: "rules", label: "Rules", kinds: ["rulebook.set", "rule.refused", "kill", "resume"] },
  { id: "notes", label: "Notes", kinds: ["question", "note"] },
];

const TONE: Partial<Record<LedgerKind, string>> = {
  "payment.settled": "text-amber",
  "payment.signed": "text-amber",
  "payment.preview": "text-amber/70",
  discovery: "text-amber/70",
  "order.filled": "text-ok",
  "order.sent": "text-ok",
  approval: "text-ok",
  "order.failed": "text-bad",
  "rule.refused": "text-bad",
  kill: "text-bad",
  rejection: "text-warn",
  resume: "text-warn",
  "rulebook.set": "text-warn",
};

export function LedgerTable({
  token,
  entries,
  loading,
  problem,
  onRetry,
  onUnauthorized,
}: {
  token: string;
  entries: LedgerEntry[];
  loading: boolean;
  problem: { message: string; nextStep: string } | null;
  onRetry: () => void;
  onUnauthorized: () => void;
}) {
  const shouldReduce = useReducedMotion() ?? false;
  const [group, setGroup] = useState("all");
  const [open, setOpen] = useState<number | null>(null);
  const [check, setCheck] = useState<ChainCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkProblem, setCheckProblem] = useState<{ message: string; nextStep: string } | null>(
    null,
  );

  const shown = useMemo(() => {
    const kinds = GROUPS.find((entry) => entry.id === group)?.kinds ?? null;
    const filtered = kinds === null ? entries : entries.filter((entry) => kinds.includes(entry.kind));
    return [...filtered].sort((a, b) => b.seq - a.seq);
  }, [entries, group]);

  const verify = async () => {
    setChecking(true);
    setCheckProblem(null);
    try {
      setCheck(await verifyLedger(token));
    } catch (error) {
      if (error instanceof OlaiError && error.unauthorized) {
        onUnauthorized();
        return;
      }
      const failure = say(error);
      setCheckProblem({ message: failure.message, nextStep: failure.nextStep });
    } finally {
      setChecking(false);
    }
  };

  return (
    <section className="desk-panel flex min-h-[24rem] flex-col p-6">
      <header className="flex items-baseline justify-between gap-4">
        <h2 className="desk-heading">Ledger</h2>
        <span className="font-mono text-[0.62rem] uppercase tracking-[0.18em] text-ink/35">
          {entries.length} {entries.length === 1 ? "line" : "lines"}
        </span>
      </header>

      <div className="mt-5 flex flex-wrap gap-2">
        {GROUPS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setGroup(entry.id)}
            className={`desk-filter ${group === entry.id ? "is-on" : ""}`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void verify()}
          disabled={checking}
          className="desk-button-quiet px-4 py-2 text-[0.8rem]"
        >
          {checking ? "Checking…" : "Verify chain"}
        </button>
        {check ? (
          check.ok ? (
            <span className="font-mono text-[0.72rem] uppercase tracking-[0.14em] text-ok">
              Chain holds across {check.length} lines
            </span>
          ) : (
            <span className="font-mono text-[0.72rem] uppercase tracking-[0.14em] text-bad">
              Broken at line {check.brokenAtSeq}
            </span>
          )
        ) : null}
      </div>
      {check && !check.ok ? (
        <p className="mt-2 text-[0.82rem] leading-[1.45] text-bad">{check.reason}</p>
      ) : null}
      {checkProblem ? (
        <div className="mt-2">
          <p className="text-[0.85rem] leading-[1.45] text-bad">{checkProblem.message}</p>
          <p className="mt-1 text-[0.8rem] leading-[1.45] text-ink/55">{checkProblem.nextStep}</p>
        </div>
      ) : null}

      {problem ? (
        <div className="mt-6">
          <p className="text-[0.88rem] leading-[1.45] text-bad">{problem.message}</p>
          <p className="mt-1 text-[0.82rem] leading-[1.45] text-ink/55">{problem.nextStep}</p>
          <button type="button" onClick={onRetry} className="desk-button-quiet mt-4 px-4 py-2 text-[0.82rem]">
            Try again
          </button>
        </div>
      ) : loading ? (
        <div className="mt-6 space-y-2" aria-hidden>
          {[0, 1, 2, 3, 4, 5].map((row) => (
            <div key={`ledger-skeleton-${row}`} className="desk-skeleton h-7" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <p className="mt-6 text-[0.9rem] leading-[1.5] text-ink/45">
          {entries.length === 0
            ? "Nothing yet. Ask Olai a question."
            : "No lines of that kind yet."}
        </p>
      ) : (
        <div className="desk-scroll mt-5 max-h-[38rem] flex-1 pr-2" data-lenis-prevent>
          <AnimatePresence initial={false}>
            {shown.map((entry) => (
              <motion.div
                key={entry.seq}
                layout={!shouldReduce}
                initial={shouldReduce ? { opacity: 1 } : { opacity: 0, x: 28 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
                className="border-b border-ink/[0.06] last:border-0"
              >
                <button
                  type="button"
                  onClick={() => setOpen(open === entry.seq ? null : entry.seq)}
                  aria-expanded={open === entry.seq}
                  className="flex w-full flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5 text-left transition-colors duration-200 hover:bg-ink/[0.03] sm:grid sm:grid-cols-[2.4rem_4.6rem_8rem_1fr_4.5rem_6rem] sm:items-baseline"
                >
                  <span className="hidden font-mono text-[0.7rem] text-ink/25 sm:block">
                    {entry.seq}
                  </span>
                  <span className="font-mono text-[0.7rem] text-ink/35">{clockTime(entry.ts)}</span>
                  <span
                    className={`font-mono text-[0.7rem] uppercase tracking-[0.1em] ${TONE[entry.kind] ?? "text-ink/45"}`}
                  >
                    {entry.kind}
                  </span>
                  <span className="w-full min-w-0 truncate text-[0.85rem] text-ink/75 sm:w-auto">
                    {summarise(entry)}
                  </span>
                  <span className="ml-auto font-mono text-[0.72rem] text-amber sm:ml-0 sm:text-right">
                    {entry.costUsd === undefined ? "" : usd(entry.costUsd)}
                  </span>
                  <span className="font-mono text-[0.7rem] text-ink/30 sm:text-right">
                    {entry.txHash ? shortHash(entry.txHash) : ""}
                  </span>
                </button>

                <AnimatePresence>
                  {open === entry.seq ? (
                    <motion.div
                      initial={shouldReduce ? { opacity: 1 } : { opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={shouldReduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
                      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                      className="overflow-hidden"
                    >
                      <div className="mb-3 rounded-control border border-ink/10 bg-ink/[0.02] p-4">
                        <p className="font-mono text-[0.66rem] uppercase tracking-[0.16em] text-ink/35">
                          {entry.actor} · line {entry.seq} · hash {shortHash(entry.hash)}
                        </p>
                        {entry.txHash ? (
                          <a
                            href={bscscan(entry.txHash)}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-2 inline-block font-mono text-[0.72rem] text-ok underline decoration-ok/30 underline-offset-4 transition-colors duration-200 hover:decoration-ok"
                          >
                            {shortHash(entry.txHash)} on BscScan
                          </a>
                        ) : null}
                        <pre className="desk-json mt-3">{JSON.stringify(entry.payload, null, 2)}</pre>
                      </div>
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </section>
  );
}

function summarise(entry: LedgerEntry): string {
  const summary = entry.payload?.summary;
  if (typeof summary === "string" && summary.trim() !== "") {
    return summary;
  }
  const question = entry.payload?.question;
  if (typeof question === "string" && question.trim() !== "") {
    return question;
  }
  return entry.kind;
}
