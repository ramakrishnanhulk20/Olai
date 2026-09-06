"use client";

import { useEffect, useRef } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { BrainEvent } from "@/lib/sse";

/**
 * Olai thinking out loud.
 *
 * This is the live feed, not the record. Every line here is also written to the
 * ledger, so a dropped connection loses the commentary and nothing else.
 */
export function ThinkingStream({
  events,
  running,
  live,
}: {
  events: BrainEvent[];
  running: boolean;
  live: boolean;
}) {
  const shouldReduce = useReducedMotion() ?? false;
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (events.length === 0) {
      return;
    }
    endRef.current?.scrollIntoView({ block: "end", behavior: shouldReduce ? "auto" : "smooth" });
  }, [events.length, shouldReduce]);

  return (
    <section className="desk-panel p-6">
      <header className="flex items-baseline justify-between gap-4">
        <h2 className="desk-heading">Thinking</h2>
        <span
          className={`font-mono text-[0.62rem] uppercase tracking-[0.18em] ${
            live ? "text-ok" : "text-ink/35"
          }`}
        >
          {live ? "Live feed" : "Feed reconnecting"}
        </span>
      </header>

      {events.length === 0 ? (
        <p className="mt-5 text-[0.9rem] leading-[1.5] text-ink/45">
          {running
            ? "Waiting for Olai's first move."
            : "Nothing yet. Ask Olai a question and every step it takes shows up here."}
        </p>
      ) : (
        <div className="desk-scroll mt-5 max-h-[26rem] pr-2" data-lenis-prevent>
          <AnimatePresence initial={false}>
            {events.map((event, index) => (
              <motion.div
                key={`brain-${index}-${event.type}`}
                initial={shouldReduce ? { opacity: 1 } : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                className="border-b border-ink/[0.06] py-2.5 last:border-0"
              >
                <Line event={event} />
              </motion.div>
            ))}
          </AnimatePresence>
          <div ref={endRef} />
        </div>
      )}
    </section>
  );
}

function Line({ event }: { event: BrainEvent }) {
  if (event.type === "thinking") {
    return (
      <p className="font-mono text-[0.78rem] leading-[1.6] text-ink/40">{event.text}</p>
    );
  }

  if (event.type === "tool") {
    return (
      <p className="flex items-start gap-2.5">
        <span className="mt-[0.45rem] block size-2 shrink-0 rounded-[2px] bg-amber" />
        <span className="min-w-0">
          <span className="font-mono text-[0.84rem] text-amber">{event.name}</span>
          <span className="ml-2 break-words font-mono text-[0.75rem] text-ink/40">
            {clip(event.input)}
          </span>
        </span>
      </p>
    );
  }

  if (event.type === "tool.result") {
    return (
      <p className="pl-[1.15rem] text-[0.85rem] leading-[1.5] text-ink/65">
        <span className="font-mono text-[0.72rem] uppercase tracking-[0.14em] text-ink/30">
          {event.name}
        </span>
        <span className="ml-2">{event.summary}</span>
      </p>
    );
  }

  if (event.type === "text") {
    return <p className="text-[0.95rem] leading-[1.55] text-ink/85">{event.text}</p>;
  }

  return (
    <p className="font-mono text-[0.78rem] uppercase tracking-[0.16em] text-ok">
      Proposal ready
    </p>
  );
}

/** Tool inputs are the model's own JSON. Show enough to follow, never a wall. */
function clip(input: unknown): string {
  let text: string;
  try {
    text = typeof input === "string" ? input : JSON.stringify(input);
  } catch {
    return "";
  }
  if (!text) {
    return "";
  }
  return text.length > 110 ? `${text.slice(0, 110)}…` : text;
}
