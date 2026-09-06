"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { ProposalStatus, SessionRecord } from "@/lib/api";
import { ago } from "@/lib/format";

/**
 * Every session the service is holding, newest first.
 *
 * The desk used to load this list once, so a session started from the API or
 * another tab was invisible and an approval went to the wrong id. The list is
 * live now and the owner picks from it, which is why the arrival notice sits
 * here rather than somewhere the eye has to hunt for it.
 */

const TONE: Record<ProposalStatus, { label: string; text: string; dot: string }> = {
  pending: { label: "Waiting for you", text: "text-warn", dot: "bg-warn" },
  approved: { label: "Approved", text: "text-ok", dot: "bg-ok" },
  executed: { label: "Executed", text: "text-ok", dot: "bg-ok" },
  refused: { label: "Refused", text: "text-bad", dot: "bg-bad" },
  rejected: { label: "You said no", text: "text-ink/45", dot: "bg-ink/40" },
  failed: { label: "Failed", text: "text-bad", dot: "bg-bad" },
};

export interface Arrival {
  id: string;
  switched: boolean;
}

export function SessionPicker({
  sessions,
  currentId,
  loading,
  arrival,
  replay = false,
  onPick,
  onDismiss,
}: {
  sessions: SessionRecord[];
  currentId: string | null;
  loading: boolean;
  arrival: Arrival | null;
  replay?: boolean;
  onPick?: (id: string) => void;
  onDismiss?: () => void;
}) {
  const shouldReduce = useReducedMotion() ?? false;

  return (
    <section className="desk-panel p-5 sm:p-6">
      <header className="flex items-baseline justify-between gap-4">
        <h2 className="desk-heading">Sessions</h2>
        <span className="font-mono text-[0.62rem] uppercase tracking-[0.18em] text-ink/30">
          {replay
            ? "One recorded session"
            : sessions.length === 0
              ? "None yet"
              : `${sessions.length} on the service`}
        </span>
      </header>

      {sessions.length === 0 ? (
        <p className="mt-4 text-[0.88rem] leading-[1.5] text-ink/45">
          {loading
            ? "Reading the session list."
            : "Nothing on the service yet. Ask Olai a question and it lands here."}
        </p>
      ) : (
        <div
          className="desk-scroll -mx-1 mt-4 flex gap-2 overflow-x-auto px-1 pb-1 sm:mx-0 sm:max-h-[15rem] sm:flex-col sm:overflow-x-visible sm:overflow-y-auto sm:px-0 sm:pr-2"
          data-lenis-prevent
          role="group"
          aria-label="Sessions on the service"
        >
          <AnimatePresence initial={false}>
            {sessions.map((session) => {
              const tone = TONE[session.status];
              const picked = session.id === currentId;
              return (
                <motion.button
                  key={session.id}
                  type="button"
                  layout={!shouldReduce}
                  initial={shouldReduce ? { opacity: 1 } : { opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                  whileHover={shouldReduce ? undefined : { x: picked ? 0 : 2 }}
                  onClick={() => onPick?.(session.id)}
                  aria-current={picked}
                  aria-label={`${session.question}, ${tone.label}`}
                  className={`desk-session ${picked ? "is-picked" : ""}`}
                >
                  <span className="flex w-full items-center gap-2">
                    <span className={`block size-1.5 shrink-0 rounded-[2px] ${tone.dot}`} />
                    <span className="block min-w-0 flex-1 truncate text-left text-[0.86rem] leading-[1.4] text-ink/80">
                      {session.question}
                    </span>
                  </span>
                  <span className="mt-1.5 flex w-full items-center justify-between gap-3 pl-[0.875rem] font-mono text-[0.62rem] uppercase tracking-[0.16em]">
                    <span className={tone.text}>{tone.label}</span>
                    <span className="shrink-0 text-ink/30">{ago(session.createdAt)}</span>
                  </span>
                </motion.button>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      <AnimatePresence>
        {arrival ? (
          <motion.div
            initial={shouldReduce ? { opacity: 1 } : { opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-control border border-amber/35 bg-amber/[0.07] px-4 py-3"
            role="status"
          >
            <span className="font-mono text-[0.62rem] uppercase tracking-[0.18em] text-amber">
              New proposal
            </span>
            <span className="min-w-0 flex-1 text-[0.84rem] leading-[1.45] text-ink/70">
              {arrival.switched
                ? "A session arrived while you were on an older one. The desk moved you to it."
                : "Another session arrived and is waiting for you."}
            </span>
            {arrival.switched ? null : (
              <button
                type="button"
                onClick={() => onPick?.(arrival.id)}
                className="desk-filter shrink-0"
              >
                Open it
              </button>
            )}
            <button
              type="button"
              onClick={() => onDismiss?.()}
              className="desk-filter shrink-0"
              aria-label="Dismiss the new proposal notice"
            >
              Dismiss
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </section>
  );
}
