"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

/**
 * One labelled button for the thing that stops the agent.
 *
 * Stopping asks first, because it refuses every order and every payment until
 * the owner comes back. Resuming does not: undoing a stop is the safe direction.
 *
 * The confirm is portalled to the body. The header above it has a backdrop
 * filter, which makes it the containing block for anything fixed inside it and
 * would put this dialog off the top of a phone screen.
 */
export function StopButton({
  killed,
  busy,
  disabled,
  note = null,
  problem,
  onKill,
  onResume,
}: {
  killed: boolean;
  busy: boolean;
  disabled: boolean;
  note?: string | null;
  problem: string | null;
  onKill: () => void;
  onResume: () => void;
}) {
  const shouldReduce = useReducedMotion() ?? false;
  const [asking, setAsking] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  const label = busy ? "Working" : killed ? "Resume Olai" : "Stop Olai";

  const close = useCallback(() => {
    setAsking(false);
    buttonRef.current?.focus();
  }, []);

  const click = () => {
    if (busy || disabled) {
      return;
    }
    if (killed) {
      onResume();
      return;
    }
    setAsking(true);
  };

  useEffect(() => {
    if (!asking) {
      return;
    }

    confirmRef.current?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab") {
        return;
      }
      // Tab stays in the dialog, so the page behind it is never reachable while
      // the owner is being asked a yes or no question.
      const stops = dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled])");
      if (!stops || stops.length === 0) {
        return;
      }
      const first = stops[0];
      const last = stops[stops.length - 1];
      const here = document.activeElement;
      if (event.shiftKey && (here === first || !dialogRef.current?.contains(here))) {
        event.preventDefault();
        last.focus();
        return;
      }
      if (!event.shiftKey && here === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [asking, close]);

  const confirm = (
    <AnimatePresence>
      {asking ? (
        <motion.div
          initial={shouldReduce ? { opacity: 1 } : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[130] flex items-end justify-center bg-ground/85 px-4 pb-10 backdrop-blur-sm sm:items-center sm:pb-0"
          onClick={close}
        >
          <motion.div
            ref={dialogRef}
            initial={shouldReduce ? { opacity: 1, y: 0 } : { opacity: 0, y: 26 }}
            animate={{ opacity: 1, y: 0 }}
            exit={shouldReduce ? { opacity: 0 } : { opacity: 0, y: 14 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            onClick={(event) => event.stopPropagation()}
            className="desk-panel w-full max-w-[34rem] p-7"
            role="dialog"
            aria-modal="true"
            aria-labelledby="conversation-stop-title"
          >
            <p className="font-mono text-[0.68rem] uppercase tracking-[0.2em] text-bad">
              Kill switch
            </p>
            <h2
              id="conversation-stop-title"
              className="mt-4 font-display font-extrabold text-ink"
              style={{
                fontSize: "clamp(1.6rem,3.4vw,2.4rem)",
                letterSpacing: "-0.03em",
                lineHeight: 1,
              }}
            >
              Stop Olai?
            </h2>
            <p className="mt-4 max-w-[46ch] text-[0.98rem] leading-[1.5] text-ink/70">
              Every order and payment is refused until you resume.
            </p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <button
                ref={confirmRef}
                type="button"
                onClick={() => {
                  setAsking(false);
                  onKill();
                  buttonRef.current?.focus();
                }}
                className="desk-button-bad px-6 py-3 text-[0.92rem]"
              >
                Stop Olai
              </button>
              <button
                type="button"
                onClick={close}
                className="desk-button-quiet px-6 py-3 text-[0.92rem]"
              >
                Keep running
              </button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={click}
        disabled={busy || disabled}
        title={note ?? label}
        className={`conv-stop ${killed ? "is-stopped" : ""}`}
      >
        {label}
      </button>

      {typeof document === "undefined" ? null : createPortal(confirm, document.body)}

      {problem ? (
        <span className="absolute right-0 top-full mt-2 w-[16rem] text-right text-[0.75rem] leading-[1.4] text-bad">
          {problem}
        </span>
      ) : null}
    </div>
  );
}
