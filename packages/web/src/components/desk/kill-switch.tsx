"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

/**
 * The stop button, built to look like one.
 *
 * Stopping asks first, because it refuses every order and every payment until
 * the owner comes back. Resuming does not: undoing a stop is the safe direction.
 *
 * The confirm is portalled to the body. Its old home was inside the sticky
 * header, and a backdrop filter on that header makes it the containing block for
 * anything fixed inside it, which put the dialog off the top of a phone screen
 * where the owner could not reach the one button that stops the agent.
 *
 * A note in place of the running word means the switch is not this visitor's to
 * throw, so the word Running is never printed next to a switch nobody can use.
 */
export function KillSwitch({
  killed,
  busy,
  disabled,
  offline = false,
  problem,
  note = null,
  onKill,
  onResume,
}: {
  killed: boolean;
  busy: boolean;
  disabled: boolean;
  offline?: boolean;
  problem: string | null;
  note?: string | null;
  onKill: () => void;
  onResume: () => void;
}) {
  const shouldReduce = useReducedMotion() ?? false;
  const [asking, setAsking] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  const state = note ?? (offline ? "Not connected" : killed ? "Stopped" : "Running");
  const action = note ?? (killed ? "Resume Olai" : "Stop Olai");

  const close = useCallback(() => {
    setAsking(false);
    toggleRef.current?.focus();
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
          className="fixed inset-0 z-[120] flex items-end justify-center bg-ground/85 px-4 pb-10 backdrop-blur-sm sm:items-center sm:pb-0"
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
            aria-labelledby="kill-switch-title"
          >
            <p className="font-mono text-[0.68rem] uppercase tracking-[0.2em] text-bad">
              Kill switch
            </p>
            <h2
              id="kill-switch-title"
              className="mt-4 font-display font-extrabold text-ink"
              style={{ fontSize: "clamp(1.6rem,3.4vw,2.4rem)", letterSpacing: "-0.03em", lineHeight: 1 }}
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
                  toggleRef.current?.focus();
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
    <div className="relative flex items-center gap-2 sm:gap-3">
      <span
        className={`hidden font-mono text-[0.66rem] uppercase tracking-[0.18em] sm:block ${
          note ? "max-w-[11rem] text-right leading-[1.5] text-ink/55" : "text-ink/55"
        }`}
      >
        {state}
      </span>

      <button
        ref={toggleRef}
        type="button"
        onClick={click}
        disabled={busy || disabled}
        role="switch"
        aria-checked={!killed}
        aria-label={action}
        title={action}
        className="desk-toggle-hit"
      >
        <span
          className={`desk-toggle ${killed ? "is-off" : "is-on"} ${busy ? "is-busy" : ""}`}
          aria-hidden
        >
          <motion.span
            className="desk-toggle-knob"
            layout={!shouldReduce}
            transition={{ type: "spring", stiffness: 520, damping: 34 }}
          />
        </span>
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
