"use client";

import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { ProposalStatus, SessionRecord } from "@/lib/api";
import { ago } from "@/lib/format";

/**
 * Every question this desk has been asked, newest first.
 *
 * On a wide screen it is a rail beside the conversation. At laptop width it
 * folds to a strip of numbers, and on a phone it is a dropdown above the
 * conversation, because a rail there would take the whole screen.
 */

const TONE: Record<ProposalStatus, { label: string; text: string; dot: string }> = {
  pending: { label: "Waiting for you", text: "text-warn", dot: "bg-warn" },
  approved: { label: "Approved", text: "text-ok", dot: "bg-ok" },
  executed: { label: "Done", text: "text-ok", dot: "bg-ok" },
  refused: { label: "Refused", text: "text-bad", dot: "bg-bad" },
  rejected: { label: "You said no", text: "text-ink/60", dot: "bg-ink/40" },
  failed: { label: "Failed", text: "text-bad", dot: "bg-bad" },
};

function excerpt(question: string): string {
  const trimmed = question.trim();
  return trimmed.length > 120 ? `${trimmed.slice(0, 120)}…` : trimmed;
}

export function SessionRail({
  sessions,
  currentId,
  loading,
  mounted,
  onPick,
}: {
  sessions: SessionRecord[];
  currentId: string | null;
  loading: boolean;
  mounted: boolean;
  onPick: (id: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside className="conv-rail" data-strip={collapsed ? "" : undefined}>
      <div className="flex items-center justify-between gap-2">
        <p className="conv-rail-label desk-label">Earlier questions</p>
        <button
          type="button"
          onClick={() => setCollapsed((open) => !open)}
          className="conv-rail-toggle text-ink/55 transition-colors duration-300 hover:text-amber"
          aria-label={collapsed ? "Widen the question rail" : "Collapse the question rail"}
          title={collapsed ? "Widen the rail" : "Collapse the rail"}
        >
          <svg viewBox="0 0 16 16" className="size-4" fill="none" aria-hidden>
            <path
              d={collapsed ? "M6 3l5 5-5 5" : "M10 3L5 8l5 5"}
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      {sessions.length === 0 ? (
        <p className="conv-rail-label mt-5 text-[0.84rem] leading-[1.5] text-ink/60">
          {loading ? "Reading the list." : "Nothing yet. Your first question lands here."}
        </p>
      ) : (
        <div
          className="desk-scroll mt-4 flex min-h-0 flex-1 flex-col gap-1 pr-1"
          data-lenis-prevent
        >
          {sessions.map((session, index) => {
            const tone = TONE[session.status];
            const picked = session.id === currentId;
            return (
              <button
                key={session.id}
                type="button"
                onClick={() => onPick(session.id)}
                aria-current={picked}
                title={session.question}
                className={`conv-rail-item ${picked ? "is-picked" : ""}`}
              >
                <span className="flex items-start gap-2.5">
                  <span className="conv-rail-seq shrink-0">{index + 1}</span>
                  <span className="conv-rail-label min-w-0 flex-1">
                    <span className="line-clamp-2 text-[0.85rem] leading-[1.4] text-ink/80">
                      {excerpt(session.question)}
                    </span>
                    <span className="mt-1.5 flex items-center gap-2 font-mono text-[0.6rem] uppercase tracking-[0.14em]">
                      <span className={`block size-1.5 shrink-0 rounded-[1px] ${tone.dot}`} />
                      <span className={tone.text}>{tone.label}</span>
                      <span className="ml-auto text-ink/55">
                        {mounted ? ago(session.createdAt) : ""}
                      </span>
                    </span>
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </aside>
  );
}

/** The same list on a phone, folded into one control. */
export function SessionDropdown({
  sessions,
  currentId,
  mounted,
  onPick,
}: {
  sessions: SessionRecord[];
  currentId: string | null;
  mounted: boolean;
  onPick: (id: string) => void;
}) {
  const shouldReduce = useReducedMotion() ?? false;
  const [open, setOpen] = useState(false);

  if (sessions.length === 0) {
    return null;
  }

  return (
    <div className="lg:hidden">
      <button
        type="button"
        onClick={() => setOpen((shown) => !shown)}
        aria-expanded={open}
        className="conv-drawer-button w-full justify-between"
      >
        <span>Earlier questions</span>
        <span className="font-mono text-[0.72rem] text-ink/60">{sessions.length}</span>
      </button>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            initial={shouldReduce ? { opacity: 1 } : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={shouldReduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="mt-2 flex flex-col gap-1">
              {sessions.map((session, index) => {
                const tone = TONE[session.status];
                return (
                  <button
                    key={session.id}
                    type="button"
                    onClick={() => {
                      onPick(session.id);
                      setOpen(false);
                    }}
                    aria-current={session.id === currentId}
                    className={`conv-rail-item ${session.id === currentId ? "is-picked" : ""}`}
                  >
                    <span className="flex items-start gap-2.5">
                      <span className="conv-rail-seq shrink-0">{index + 1}</span>
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-2 text-[0.85rem] leading-[1.4] text-ink/80">
                          {excerpt(session.question)}
                        </span>
                        <span className="mt-1.5 flex items-center gap-2 font-mono text-[0.6rem] uppercase tracking-[0.14em]">
                          <span className={`block size-1.5 shrink-0 rounded-[1px] ${tone.dot}`} />
                          <span className={tone.text}>{tone.label}</span>
                          <span className="ml-auto text-ink/55">
                            {mounted ? ago(session.createdAt) : ""}
                          </span>
                        </span>
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
