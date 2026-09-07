"use client";

import { motion, useReducedMotion } from "framer-motion";

/**
 * The line that has to be read before anything else on this screen.
 *
 * It sits inside the sticky header, so it never scrolls out of the way, and the
 * only thing next to it is the way out for the one person who does have a token.
 *
 * The server does not know whether this visitor asked for less motion, so the
 * entrance is always described the same way and only its duration changes.
 * Branching on it here would hand the browser different markup than it got.
 */
export function ReplayBanner({ onOpenGate }: { onOpenGate: () => void }) {
  const shouldReduce = useReducedMotion() ?? false;

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: shouldReduce ? 0 : 0.6, ease: [0.16, 1, 0.3, 1] }}
      role="status"
      className="border-t border-amber/30 bg-amber/[0.07] px-[clamp(1rem,3vw,2.75rem)] py-2.5"
    >
      <div className="flex flex-col gap-x-5 gap-y-1.5 sm:flex-row sm:flex-wrap sm:items-baseline">
        <span className="flex items-center gap-2.5 font-mono text-[0.62rem] uppercase tracking-[0.22em] text-amber">
          <motion.span
            className="block size-2 shrink-0 rounded-[2px] bg-amber"
            animate={{ opacity: [1, 0.3, 1] }}
            transition={{
              duration: shouldReduce ? 0 : 2.6,
              repeat: shouldReduce ? 0 : Infinity,
              ease: "easeInOut",
            }}
          />
          Replay
        </span>

        <p className="min-w-0 flex-1 text-[0.9rem] leading-[1.45] text-ink/85">
          A replay of a recorded run. Nothing here is live.
        </p>

        <button
          type="button"
          onClick={onOpenGate}
          className="conv-tap group w-fit shrink-0 text-left text-[0.85rem] leading-[1.45] text-ink/55 transition-colors duration-300 hover:text-amber"
        >
          <span className="border-b border-ink/20 pb-0.5 transition-colors duration-300 group-hover:border-amber">
            Owner? Enter your token
          </span>
        </button>
      </div>
    </motion.div>
  );
}
