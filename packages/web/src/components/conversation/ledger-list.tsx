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
import { describe } from "@/lib/describe";
import { clockTime, shortHash, usd } from "@/lib/format";

/**
 * The receipt, newest first, in the same sentences the conversation uses.
 *
 * Every line is hashed onto the one before it, so the verify button is not
 * decoration: it recomputes the whole chain on the service and names the first
 * line that does not match. A replay has no service to recompute anything, so it
 * says when the chain was checked instead of offering a button that proves
 * nothing.
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

export function LedgerList({
  token,
  entries,
  loading,
  problem,
  replay,
  mounted,
  onRetry,
  onUnauthorized,
}: {
  token?: string;
  entries: LedgerEntry[];
  loading: boolean;
  problem: { message: string; nextStep: string } | null;
  replay?: { lines: number };
  mounted: boolean;
  onRetry?: () => void;
  onUnauthorized?: () => void;
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
    const filtered =
      kinds === null ? entries : entries.filter((entry) => kinds.includes(entry.kind));
    return [...filtered].sort((a, b) => b.seq - a.seq);
  }, [entries, group]);

  const verify = async () => {
    setChecking(true);
    setCheckProblem(null);
    try {
      setCheck(await verifyLedger(token ?? ""));
    } catch (error) {
      if (error instanceof OlaiError && error.unauthorized) {
        onUnauthorized?.();
        return;
      }
      const failure = say(error);
      setCheckProblem({ message: failure.message, nextStep: failure.nextStep });
    } finally {
      setChecking(false);
    }
  };

  return (
    <section>
      <header className="flex items-baseline justify-between gap-4">
        <h3 className="desk-heading">The receipt</h3>
        <span className="font-mono text-[0.62rem] uppercase tracking-[0.18em] text-ink/55">
          {entries.length} {entries.length === 1 ? "line" : "lines"}
        </span>
      </header>

      <div className="mt-4 flex flex-wrap gap-2">
        {GROUPS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setGroup(entry.id)}
            aria-pressed={group === entry.id}
            className={`desk-filter ${group === entry.id ? "is-on" : ""}`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {replay ? (
          <p className="font-mono text-[0.72rem] uppercase tracking-[0.14em] text-ink/55">
            Recorded chain: verified at capture, {replay.lines} lines
          </p>
        ) : (
          <button
            type="button"
            onClick={() => void verify()}
            disabled={checking}
            className="desk-button-quiet px-4 py-2 text-[0.8rem]"
          >
            {checking ? "Checking" : "Verify chain"}
          </button>
        )}
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
        <div className="mt-2" role="alert">
          <p className="text-[0.85rem] leading-[1.45] text-bad">{checkProblem.message}</p>
          <p className="mt-1 text-[0.8rem] leading-[1.45] text-ink/60">{checkProblem.nextStep}</p>
        </div>
      ) : null}

      {problem ? (
        <div className="mt-6" role="alert">
          <p className="text-[0.88rem] leading-[1.45] text-bad">{problem.message}</p>
          <p className="mt-1 text-[0.82rem] leading-[1.45] text-ink/60">{problem.nextStep}</p>
          <button
            type="button"
            onClick={() => onRetry?.()}
            className="desk-button-quiet mt-4 px-4 py-2 text-[0.82rem]"
          >
            Try again
          </button>
        </div>
      ) : loading ? (
        <div className="mt-6 space-y-2" aria-hidden>
          {[0, 1, 2, 3, 4, 5].map((row) => (
            <div key={`receipt-skeleton-${row}`} className="desk-skeleton h-9" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <p className="mt-6 text-[0.9rem] leading-[1.5] text-ink/60">
          {entries.length === 0
            ? replay
              ? "The recorded run carries no lines."
              : "Nothing yet. Ask Olai a question."
            : "No lines of that kind yet."}
        </p>
      ) : (
        <ol className="mt-5 flex flex-col">
          <AnimatePresence initial={false}>
            {shown.map((entry) => {
              const said = describe(entry);
              const isOpen = open === entry.seq;
              return (
                <motion.li
                  key={entry.seq}
                  layout={!shouldReduce}
                  initial={shouldReduce ? { opacity: 1 } : { opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                  className="border-b border-ink/[0.06] py-2.5 last:border-0"
                >
                  <div className="grid grid-cols-[0.55rem_minmax(0,1fr)] gap-3">
                    <span className="conv-mark mt-[0.42rem]" data-tone={said.tone} aria-hidden />
                    <div className="min-w-0">
                      <p className="text-[0.9rem] leading-[1.5] text-ink/80">{said.sentence}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="font-mono text-[0.64rem] text-ink/55">
                          {entry.seq}
                          {mounted ? ` · ${clockTime(entry.ts)}` : ""}
                        </span>
                        {entry.costUsd === undefined ? null : (
                          <span className="font-mono text-[0.68rem] text-amber">
                            {usd(entry.costUsd)}
                          </span>
                        )}
                        {said.href && entry.txHash ? (
                          <a
                            href={said.href}
                            target="_blank"
                            rel="noreferrer"
                            className="conv-link"
                          >
                            {shortHash(entry.txHash)} on BscScan
                          </a>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => setOpen(isOpen ? null : entry.seq)}
                          aria-expanded={isOpen}
                          className="conv-open"
                        >
                          {isOpen ? "Hide the line" : "The ledger line"}
                        </button>
                      </div>

                      <AnimatePresence>
                        {isOpen ? (
                          <motion.div
                            initial={shouldReduce ? { opacity: 1 } : { opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            exit={shouldReduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
                            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                            className="overflow-hidden"
                          >
                            <pre className="desk-json mt-2 rounded-control border border-ink/10 bg-ink/[0.02] p-3">
                              {said.detail}
                            </pre>
                          </motion.div>
                        ) : null}
                      </AnimatePresence>
                    </div>
                  </div>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ol>
      )}
    </section>
  );
}
