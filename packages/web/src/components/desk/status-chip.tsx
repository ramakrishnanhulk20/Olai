"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { Health } from "@/lib/api";

/**
 * What Olai is doing right now, in three words.
 *
 * The desk polls /health and hands the answer here. No answer at all is its own
 * state: an offline service must never read as a calm dry run.
 */
export function StatusChip({ health, offline }: { health: Health | null; offline: boolean }) {
  const shouldReduce = useReducedMotion() ?? false;

  const state = offline
    ? { label: "No service", tone: "text-bad", dot: "bg-bad", border: "border-bad/40" }
    : health === null
      ? { label: "Checking", tone: "text-ink/50", dot: "bg-ink/40", border: "border-ink/15" }
      : health.killed
        ? { label: "Stopped", tone: "text-bad", dot: "bg-bad", border: "border-bad/40" }
        : health.dryRun
          ? { label: "Dry run", tone: "text-ink/75", dot: "bg-ink/45", border: "border-ink/20" }
          : { label: "Live", tone: "text-ok", dot: "bg-ok", border: "border-ok/40" };

  return (
    <span
      className={`inline-flex items-center gap-2 rounded-control border px-3 py-1.5 font-mono text-[0.68rem] uppercase tracking-[0.18em] transition-colors duration-300 ${state.border} ${state.tone}`}
      title={
        offline
          ? "The service is not answering. Start it with npm run dev -w @olai/agent."
          : health
            ? `Olai ${health.version}`
            : "Asking the service how it is"
      }
    >
      <motion.span
        className={`block size-1.5 rounded-[2px] ${state.dot}`}
        animate={shouldReduce || offline ? undefined : { opacity: [1, 0.35, 1] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
      />
      {state.label}
    </span>
  );
}
