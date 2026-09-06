"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

/**
 * The one box that costs money.
 *
 * A session runs for a minute or more, so the wait is labelled with what Olai
 * is actually doing and how long it has been at it. A spinner alone on this
 * screen would read as a hang.
 */
export function AskBox({
  running,
  disabled,
  disabledReason,
  placeholder = "Should I trim my BNB position?",
  problem,
  onAsk,
}: {
  running: boolean;
  disabled: boolean;
  disabledReason: string | null;
  placeholder?: string;
  problem: { message: string; nextStep: string } | null;
  onAsk: (question: string) => void;
}) {
  const shouldReduce = useReducedMotion() ?? false;
  const [question, setQuestion] = useState("");
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!running) {
      return;
    }
    const started = Date.now();
    const timer = setInterval(() => setSeconds(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [running]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const text = question.trim();
    if (text === "" || running || disabled) {
      return;
    }
    setSeconds(0);
    onAsk(text);
    setQuestion("");
  };

  return (
    <section className="desk-panel relative overflow-hidden p-6 sm:p-8">
      <div
        className="pointer-events-none absolute -right-24 -top-32 size-[26rem] opacity-70"
        style={{
          background:
            "radial-gradient(closest-side, rgba(245,165,36,0.16), rgba(245,165,36,0) 70%)",
        }}
        aria-hidden
      />

      <form onSubmit={submit} className="relative">
        <p className="desk-label">Ask Olai</p>
        <textarea
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              submit(event);
            }
          }}
          rows={3}
          maxLength={2000}
          disabled={running || disabled}
          placeholder={placeholder}
          aria-label="Your question for Olai"
          className="desk-input mt-3 min-h-[6.5rem] w-full resize-y font-body text-[1.05rem] leading-[1.5]"
        />

        <div className="mt-4 flex flex-wrap items-center gap-4">
          <motion.button
            type="submit"
            disabled={running || disabled || question.trim() === ""}
            whileHover={shouldReduce || running ? undefined : { scale: 1.02 }}
            whileTap={shouldReduce || running ? undefined : { scale: 0.99 }}
            transition={{ type: "spring", stiffness: 420, damping: 28 }}
            className="desk-button-amber px-7 py-3.5 text-[0.95rem]"
          >
            {running ? "Olai is working…" : "Ask Olai"}
          </motion.button>

          <span className="font-mono text-[0.66rem] uppercase tracking-[0.16em] text-ink/55">
            Every answer is paid for from the wallet
          </span>
        </div>

        <AnimatePresence>
          {running ? (
            <motion.div
              initial={shouldReduce ? { opacity: 1 } : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="mt-5"
            >
              <div className="desk-wait" aria-hidden>
                <span />
              </div>
              <p className="mt-3 text-[0.88rem] leading-[1.45] text-ink/60">
                Olai is reading the market and shopping for data, this can take a minute.
                <span className="ml-2 font-mono text-[0.78rem] text-ink/55">{seconds}s</span>
              </p>
              <p className="mt-1.5 text-[0.82rem] leading-[1.45] text-ink/55">
                Paid data comes out of the wallet&apos;s daily limit and the rulebook&apos;s data
                budget.
              </p>
            </motion.div>
          ) : null}
        </AnimatePresence>

        {disabled && disabledReason && !running ? (
          <p className="mt-4 text-[0.85rem] leading-[1.45] text-ink/55">{disabledReason}</p>
        ) : null}

        {problem ? (
          <div className="mt-4">
            <p className="text-[0.88rem] leading-[1.45] text-bad">{problem.message}</p>
            <p className="mt-1 text-[0.82rem] leading-[1.45] text-ink/55">{problem.nextStep}</p>
          </div>
        ) : null}
      </form>
    </section>
  );
}
