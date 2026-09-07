"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

/**
 * The one box that costs money.
 *
 * A session runs for a minute or more, so the wait says what Olai is doing and
 * how long it has been at it. A spinner alone on this screen would read as a
 * hang, and the line under it names who pays for the data.
 *
 * A box nobody can type in says so in one place, the placeholder. A second line
 * under the box repeating it is the line that lands on top of the conversation
 * on a phone, where the composer is stuck to the bottom of the screen.
 */
export function Composer({
  value,
  running,
  disabled,
  disabledReason,
  problem,
  onChange,
  onAsk,
}: {
  value: string;
  running: boolean;
  disabled: boolean;
  disabledReason: string | null;
  problem: { message: string; nextStep: string } | null;
  onChange: (value: string) => void;
  onAsk: (question: string) => void;
}) {
  const shouldReduce = useReducedMotion() ?? false;
  const boxRef = useRef<HTMLTextAreaElement>(null);

  // The box grows with the question up to a ceiling, so a long question is read
  // in full without the composer eating the conversation above it.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) {
      return;
    }
    box.style.height = "auto";
    box.style.height = `${Math.min(box.scrollHeight, 176)}px`;
  }, [value]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const question = value.trim();
    if (question === "" || running || disabled) {
      return;
    }
    onAsk(question);
  };

  return (
    <div className="conv-composer">
      <form onSubmit={submit} className="conv-composer-box">
        <textarea
          ref={boxRef}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              submit(event);
            }
          }}
          rows={2}
          maxLength={2000}
          disabled={running || disabled}
          placeholder={
            disabled && disabledReason ? disabledReason : "Ask Olai about a position or a market"
          }
          aria-label="Your question for Olai"
          className="conv-textarea"
        />

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-[38ch] text-[0.78rem] leading-[1.4] text-ink/55">
            Paid data comes out of the wallet&apos;s daily limit and the rulebook&apos;s data
            budget.
          </p>
          <motion.button
            type="submit"
            disabled={running || disabled || value.trim() === ""}
            whileHover={{ scale: shouldReduce || running ? 1 : 1.02 }}
            whileTap={{ scale: shouldReduce || running ? 1 : 0.99 }}
            transition={{ type: "spring", stiffness: 420, damping: 28 }}
            className="desk-button-amber min-h-[44px] px-6 py-2.5 text-[0.92rem]"
          >
            {running ? "Olai is working" : "Ask Olai"}
          </motion.button>
        </div>
      </form>

      <AnimatePresence>
        {running ? (
          <motion.div
            initial={shouldReduce ? { opacity: 1 } : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mt-3"
            role="status"
          >
            <div className="desk-wait" aria-hidden>
              <span />
            </div>
            <Wait />
          </motion.div>
        ) : null}
      </AnimatePresence>

      {problem ? (
        <div className="mt-3" role="alert">
          <p className="text-[0.88rem] leading-[1.45] text-bad">{problem.message}</p>
          <p className="mt-1 text-[0.82rem] leading-[1.45] text-ink/60">{problem.nextStep}</p>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The seconds a question has been running.
 *
 * It counts from the moment it is mounted, which is the moment the question went
 * out, so a second question starts at zero without anything having to reset it.
 */
function Wait() {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => setSeconds(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <p className="mt-2.5 text-[0.86rem] leading-[1.45] text-ink/65">
      Reading the market and shopping for data, this can take a minute.
      <span className="ml-2 font-mono text-[0.78rem] text-ink/55">{seconds}s</span>
    </p>
  );
}
