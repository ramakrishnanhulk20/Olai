"use client";

import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { BrainEvent } from "@/lib/sse";

/**
 * The model's own words, folded away until they are asked for.
 *
 * The timeline above it is the record. This is the commentary that came off the
 * live feed while the record was being written, so a dropped connection loses
 * this and nothing else.
 */
export function Reasoning({
  events,
  replay = false,
}: {
  events: BrainEvent[];
  replay?: boolean;
}) {
  const shouldReduce = useReducedMotion() ?? false;
  const [open, setOpen] = useState(false);

  if (events.length === 0) {
    return null;
  }

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setOpen((shown) => !shown)}
        aria-expanded={open}
        className="conv-open"
      >
        {open ? "Hide Olai's reasoning" : "Show Olai's reasoning"}
        <span className="ml-2 text-ink/60">{events.length}</span>
      </button>

      <AnimatePresence>
        {open ? (
          <motion.div
            initial={shouldReduce ? { opacity: 1 } : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={shouldReduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div
              className="desk-scroll mt-3 max-h-[24rem] rounded-control border border-ink/10 bg-ink/[0.02] p-4 pr-3"
              data-lenis-prevent
            >
              {replay ? (
                <p className="mb-3 font-mono text-[0.6rem] uppercase tracking-[0.2em] text-ink/55">
                  Recorded feed
                </p>
              ) : null}
              <div className="flex flex-col gap-2.5">
                {events.map((event, index) => (
                  <Line key={`reasoning-${index}-${event.type}`} event={event} />
                ))}
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function Line({ event }: { event: BrainEvent }) {
  if (event.type === "thinking") {
    return <p className="font-mono text-[0.78rem] leading-[1.6] text-ink/60">{event.text}</p>;
  }

  if (event.type === "tool") {
    return (
      <p className="flex items-start gap-2.5">
        <span className="mt-[0.4rem] block size-1.5 shrink-0 rounded-[2px] bg-amber" />
        <span className="min-w-0">
          <span className="font-mono text-[0.82rem] text-amber">{event.name}</span>
          <span className="ml-2 break-words font-mono text-[0.74rem] text-ink/60">
            {clip(event.input)}
          </span>
        </span>
      </p>
    );
  }

  if (event.type === "tool.result") {
    return (
      <p className="pl-4 text-[0.85rem] leading-[1.5] text-ink/70">
        <span className="font-mono text-[0.7rem] uppercase tracking-[0.14em] text-ink/55">
          {event.name}
        </span>
        <span className="ml-2">{event.summary}</span>
      </p>
    );
  }

  if (event.type === "text") {
    return <p className="text-[0.92rem] leading-[1.55] text-ink/85">{event.text}</p>;
  }

  return (
    <p className="font-mono text-[0.74rem] uppercase tracking-[0.16em] text-ok">Proposal ready</p>
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
