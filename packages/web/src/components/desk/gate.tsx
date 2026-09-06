"use client";

import { useState } from "react";
import { motion, useReducedMotion, type Variants } from "framer-motion";

const rise: Variants = {
  hidden: { opacity: 0, y: 22 },
  show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] } },
};

const flat: Variants = { hidden: { opacity: 1, y: 0 }, show: { opacity: 1, y: 0 } };

export function Gate({
  onToken,
  notice,
}: {
  onToken: (token: string) => void;
  notice?: string | null;
}) {
  const shouldReduce = useReducedMotion() ?? false;
  const [value, setValue] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const enter = shouldReduce ? flat : rise;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const token = value.trim();
    if (token === "") {
      setProblem("Paste the owner token first. It is in .env as OLAI_OWNER_TOKEN.");
      return;
    }
    setProblem(null);
    onToken(token);
  };

  return (
    <main className="relative isolate flex min-h-[100svh] flex-col justify-end overflow-hidden bg-ground px-[clamp(1.25rem,5vw,5rem)] pb-[clamp(3rem,10vh,6rem)]">
      <div className="absolute inset-0 -z-10" aria-hidden>
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(46rem 38rem at 82% 6%, rgba(245,165,36,0.26), rgba(245,165,36,0.05) 44%, rgba(10,10,10,0) 74%)",
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(to top, #0a0a0a 12%, rgba(10,10,10,0.9) 40%, rgba(10,10,10,0) 100%)",
          }}
        />
      </div>
      <div className="film-grain absolute z-10" aria-hidden />

      <motion.div
        initial="hidden"
        animate="show"
        variants={{
          hidden: {},
          show: { transition: { staggerChildren: shouldReduce ? 0 : 0.07, delayChildren: 0.08 } },
        }}
        className="relative z-20 w-full max-w-[46rem]"
      >
        <motion.p
          variants={enter}
          className="flex items-center gap-3 font-mono text-[0.72rem] uppercase tracking-[0.22em] text-amber"
        >
          <span className="block size-2 rounded-[2px] bg-amber" />
          The owner&apos;s desk
        </motion.p>

        <motion.h1
          variants={enter}
          className="mt-6 font-display font-extrabold text-ink"
          style={{ fontSize: "clamp(2.6rem, 8vw, 6.5rem)", letterSpacing: "-0.045em", lineHeight: 0.9 }}
        >
          One token.
          <br />
          One owner.
        </motion.h1>

        <motion.p variants={enter} className="mt-7 max-w-[52ch] text-[1.05rem] leading-[1.55] text-ink/70">
          Anyone holding this token can approve a trade, so Olai keeps it in this tab only and
          never writes it to a cookie or a link.
        </motion.p>

        <motion.form variants={enter} onSubmit={submit} className="mt-9 flex flex-col gap-3 sm:flex-row">
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="ol.…"
            aria-label="Owner token"
            className="desk-input min-w-0 flex-1 font-mono text-[0.95rem] sm:max-w-[28rem]"
          />
          <motion.button
            type="submit"
            whileHover={shouldReduce ? undefined : { scale: 1.02 }}
            whileTap={shouldReduce ? undefined : { scale: 0.99 }}
            transition={{ type: "spring", stiffness: 420, damping: 28 }}
            className="desk-button-amber px-7 py-3.5 text-[0.95rem]"
          >
            Open the desk
          </motion.button>
        </motion.form>

        {(problem ?? notice) ? (
          <motion.p
            initial={shouldReduce ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-4 max-w-[52ch] text-[0.9rem] leading-[1.5] text-bad"
          >
            {problem ?? notice}
          </motion.p>
        ) : null}

        <motion.p variants={enter} className="mt-8 font-mono text-[0.72rem] uppercase tracking-[0.18em] text-ink/40">
          Set OLAI_OWNER_TOKEN in .env, it starts with ol.
        </motion.p>
      </motion.div>
    </main>
  );
}
