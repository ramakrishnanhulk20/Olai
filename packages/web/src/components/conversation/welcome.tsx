"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { Rulebook } from "@/lib/api";
import { usd } from "@/lib/format";

/**
 * What the owner reads before there is anything to read.
 *
 * The three lines are the whole product in order: the rules come first because
 * they are what makes the rest safe, the question is the only thing that costs
 * money, and the approval is the line the agent cannot cross on its own.
 */

export const EXAMPLES = [
  "Should I trim my BNB before the weekend?",
  "Is the ETH book healthy enough for a $15 buy?",
  "What are exchange wallets doing with BTC today?",
];

export function Welcome({
  rulebook,
  replay,
  onEditRulebook,
  onExample,
}: {
  rulebook: Rulebook | null;
  replay: boolean;
  onEditRulebook: () => void;
  onExample: (question: string) => void;
}) {
  const shouldReduce = useReducedMotion() ?? false;

  const rules = rulebook
    ? `Biggest order ${usd(rulebook.maxOrderUsd)}, stop for the day at ${usd(rulebook.maxDailyLossUsd)} down, ${usd(rulebook.maxDataSpendUsdPerDay)} a day for data.`
    : replay
      ? "Reading the rulebook a fresh install runs under."
      : "Reading the rulebook off the service.";

  return (
    <motion.section
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: shouldReduce ? 0 : 0.7, ease: [0.16, 1, 0.3, 1] }}
      className="conv-welcome p-6 sm:p-8"
      aria-labelledby="conversation-welcome-title"
    >
      <p className="flex items-center gap-2.5 font-mono text-[0.66rem] uppercase tracking-[0.22em] text-amber">
        <span className="block size-2 rounded-[2px] bg-amber" />
        Start here
      </p>

      <h2
        id="conversation-welcome-title"
        className="mt-5 font-display font-extrabold text-ink"
        style={{ fontSize: "clamp(1.9rem, 5vw, 3rem)", letterSpacing: "-0.04em", lineHeight: 0.95 }}
      >
        Your analyst is ready.
      </h2>

      <ol className="mt-8 flex flex-col gap-7">
        <li className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-3.5 gap-y-2">
          <span className="conv-num" aria-hidden>
            1
          </span>
          <div>
            <p className="text-[1.02rem] leading-[1.4] text-ink">Check the rulebook</p>
            <p className="mt-1.5 max-w-[54ch] text-[0.9rem] leading-[1.5] text-ink/65">{rules}</p>
            <button type="button" onClick={onEditRulebook} className="conv-tap group mt-1">
              <span className="border-b border-amber/40 pb-0.5 font-mono text-[0.7rem] uppercase tracking-[0.16em] text-amber transition-colors duration-300 group-hover:border-amber">
                {replay ? "Read it" : "Edit"}
              </span>
            </button>
          </div>
        </li>

        <li className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-3.5 gap-y-2">
          <span className="conv-num" aria-hidden>
            2
          </span>
          <div>
            <p className="text-[1.02rem] leading-[1.4] text-ink">Ask a question</p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              {EXAMPLES.map((example) => (
                <motion.button
                  key={example}
                  type="button"
                  onClick={() => onExample(example)}
                  whileHover={{ y: shouldReduce ? 0 : -2 }}
                  transition={{ type: "spring", stiffness: 420, damping: 28 }}
                  className="conv-example"
                >
                  {example}
                </motion.button>
              ))}
            </div>
          </div>
        </li>

        <li className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-3.5 gap-y-2">
          <span className="conv-num" aria-hidden>
            3
          </span>
          <div>
            <p className="text-[1.02rem] leading-[1.4] text-ink">
              Approve or reject what Olai proposes
            </p>
            <p className="mt-1.5 max-w-[54ch] text-[0.9rem] leading-[1.5] text-ink/65">
              Nothing trades without your click, and every cent and every order lands in the
              receipt.
            </p>
          </div>
        </li>
      </ol>
    </motion.section>
  );
}
