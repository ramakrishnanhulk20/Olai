"use client";

import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { LedgerEntry } from "@/lib/api";
import { describe } from "@/lib/describe";
import { clockTime, shortHash, usd } from "@/lib/format";

/**
 * What Olai did, one plain sentence per line of the record.
 *
 * Nothing here is written by this file: every sentence is the ledger line read
 * back through lib/describe, and the raw line is one click under it.
 */
export function Timeline({ entries, mounted }: { entries: LedgerEntry[]; mounted: boolean }) {
  const shouldReduce = useReducedMotion() ?? false;
  const [open, setOpen] = useState<number | null>(null);

  if (entries.length === 0) {
    return null;
  }

  return (
    <ol className="conv-steps">
      <AnimatePresence initial={false}>
        {entries.map((entry) => {
          const said = describe(entry);
          const shown = open === entry.seq;
          return (
            <motion.li
              key={entry.seq}
              layout={!shouldReduce}
              initial={shouldReduce ? { opacity: 1 } : { opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
              className="conv-step"
            >
              <span className="conv-mark" data-tone={said.tone} aria-hidden />

              <div className="min-w-0">
                <p className="conv-sentence">{said.sentence}</p>

                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-mono text-[0.66rem] text-ink/55">
                    {mounted ? clockTime(entry.ts) : ""}
                  </span>
                  {entry.costUsd === undefined ? null : (
                    <span className="font-mono text-[0.7rem] text-amber">{usd(entry.costUsd)}</span>
                  )}
                  {said.href && entry.txHash ? (
                    <a href={said.href} target="_blank" rel="noreferrer" className="conv-link">
                      {shortHash(entry.txHash)} on BscScan
                    </a>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setOpen(shown ? null : entry.seq)}
                    aria-expanded={shown}
                    className="conv-open"
                  >
                    {shown ? "Hide the line" : "The ledger line"}
                  </button>
                </div>

                <AnimatePresence>
                  {shown ? (
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
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ol>
  );
}
