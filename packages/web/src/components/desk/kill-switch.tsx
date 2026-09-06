"use client";

import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

/**
 * The stop button, built to look like one.
 *
 * Stopping asks first, because it refuses every order and every payment until
 * the owner comes back. Resuming does not: undoing a stop is the safe direction.
 */
export function KillSwitch({
  killed,
  busy,
  disabled,
  problem,
  onKill,
  onResume,
}: {
  killed: boolean;
  busy: boolean;
  disabled: boolean;
  problem: string | null;
  onKill: () => void;
  onResume: () => void;
}) {
  const shouldReduce = useReducedMotion() ?? false;
  const [asking, setAsking] = useState(false);

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

  return (
    <div className="relative flex items-center gap-3">
      <span className="hidden font-mono text-[0.66rem] uppercase tracking-[0.18em] text-ink/45 sm:block">
        {killed ? "Stopped" : "Running"}
      </span>

      <button
        type="button"
        onClick={click}
        disabled={busy || disabled}
        role="switch"
        aria-checked={!killed}
        aria-label={killed ? "Resume Olai" : "Stop Olai"}
        title={killed ? "Resume Olai" : "Stop Olai"}
        className={`desk-toggle ${killed ? "is-off" : "is-on"} ${busy ? "is-busy" : ""}`}
      >
        <motion.span
          className="desk-toggle-knob"
          layout={!shouldReduce}
          transition={{ type: "spring", stiffness: 520, damping: 34 }}
        />
      </button>

      <AnimatePresence>
        {asking ? (
          <motion.div
            initial={shouldReduce ? { opacity: 1 } : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end justify-center bg-ground/80 px-4 pb-10 backdrop-blur-sm sm:items-center sm:pb-0"
            onClick={() => setAsking(false)}
          >
            <motion.div
              initial={shouldReduce ? { opacity: 1, y: 0 } : { opacity: 0, y: 26 }}
              animate={{ opacity: 1, y: 0 }}
              exit={shouldReduce ? { opacity: 0 } : { opacity: 0, y: 14 }}
              transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
              onClick={(event) => event.stopPropagation()}
              className="desk-panel w-full max-w-[34rem] p-7"
              role="dialog"
              aria-modal="true"
            >
              <p className="font-mono text-[0.68rem] uppercase tracking-[0.2em] text-bad">
                Kill switch
              </p>
              <h2
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
                  type="button"
                  onClick={() => {
                    setAsking(false);
                    onKill();
                  }}
                  className="desk-button-bad px-6 py-3 text-[0.92rem]"
                >
                  Stop Olai
                </button>
                <button
                  type="button"
                  onClick={() => setAsking(false)}
                  className="desk-button-quiet px-6 py-3 text-[0.92rem]"
                >
                  Keep running
                </button>
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {problem ? (
        <span className="absolute right-0 top-full mt-2 w-[16rem] text-right text-[0.75rem] leading-[1.4] text-bad">
          {problem}
        </span>
      ) : null}
    </div>
  );
}
