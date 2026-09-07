"use client";

import { useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import type { LedgerEntry, SessionRecord } from "@/lib/api";
import { inConversation } from "@/lib/describe";
import type { BrainEvent } from "@/lib/sse";
import { ProposalCard } from "./proposal";
import { Reasoning } from "./reasoning";
import { Timeline } from "./timeline";

/**
 * One question, start to finish.
 *
 * The order on screen is the order it happened in: the owner asks, Olai works,
 * Olai proposes, the owner decides, and the venue answers. The proposal is the
 * only thing in the middle that is a card, because it is the only thing that
 * asks for a click.
 */
export function Thread({
  session,
  entries,
  events,
  running,
  replay = false,
  fillSentence,
  busy = null,
  problem = null,
  mounted,
  onApprove,
  onReject,
}: {
  session: SessionRecord;
  entries: LedgerEntry[];
  events: BrainEvent[];
  running: boolean;
  replay?: boolean;
  fillSentence?: string;
  busy?: "approve" | "reject" | null;
  problem?: { message: string; nextStep: string } | null;
  mounted: boolean;
  onApprove?: () => void;
  onReject?: (reason: string) => void;
}) {
  const shouldReduce = useReducedMotion() ?? false;

  const { steps, outcome } = useMemo(() => {
    const ordered = [...entries]
      .filter(inConversation)
      .filter((entry) => entry.kind !== "question")
      .sort((a, b) => a.seq - b.seq);

    let last = -1;
    ordered.forEach((entry, index) => {
      if (entry.kind === "proposal") {
        last = index;
      }
    });

    if (last === -1) {
      return { steps: ordered, outcome: [] as LedgerEntry[] };
    }
    return {
      steps: ordered.slice(0, last + 1).filter((entry) => entry.kind !== "proposal"),
      outcome: ordered.slice(last + 1),
    };
  }, [entries]);

  return (
    <div className="flex flex-col gap-7">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: shouldReduce ? 0 : 0.5, ease: [0.16, 1, 0.3, 1] }}
      >
        <p className="mb-2 text-right font-mono text-[0.62rem] uppercase tracking-[0.2em] text-ink/55">
          You asked
        </p>
        <div className="conv-bubble">
          <p className="text-[1rem] leading-[1.5] text-ink">{session.question}</p>
        </div>
      </motion.div>

      {steps.length > 0 || running ? (
        <div>
          <Timeline entries={steps} mounted={mounted} />
          {running ? (
            <p className="flex items-center gap-2.5 pl-[0.02rem] text-[0.9rem] text-ink/65">
              <motion.span
                className="block size-2 rounded-[2px] bg-amber"
                animate={shouldReduce ? undefined : { opacity: [1, 0.25, 1] }}
                transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
              />
              Olai is working
            </p>
          ) : null}
          <Reasoning events={events} replay={replay} />
        </div>
      ) : null}

      {session.proposal ? (
        <ProposalCard
          session={session}
          replay={replay}
          {...(fillSentence === undefined ? {} : { fillSentence })}
          busy={busy}
          problem={problem}
          {...(onApprove ? { onApprove } : {})}
          {...(onReject ? { onReject } : {})}
        />
      ) : null}

      {outcome.length > 0 ? (
        <div>
          <p className="mb-3 font-mono text-[0.62rem] uppercase tracking-[0.2em] text-ink/55">
            What happened next
          </p>
          <Timeline entries={outcome} mounted={mounted} />
        </div>
      ) : null}
    </div>
  );
}
