"use client";

import { motion, type Variants } from "framer-motion";
import { useCalmEntrance } from "./use-calm-entrance";

/**
 * Every field of defaultRulebook in packages/agent/src/rulebook/store.ts, written out.
 * These are the limits a fresh install runs under, so they are product defaults rather
 * than a sample: change them there and change them here.
 */
const clauses: Array<{ field: string; value: string; note?: string }> = [
  { field: "Biggest single order", value: "$20.00" },
  {
    field: "Most it may lose in a day",
    value: "$10.00",
    note: "Daily loss counts price moves as well as fills.",
  },
  { field: "Most held in one market", value: "$50.00" },
  { field: "Markets it may trade", value: "BNBUSDT, BTCUSDT, ETHUSDT" },
  { field: "May sell what it does not hold", value: "no" },
  { field: "Leverage", value: "not allowed" },
  { field: "Data budget for a day", value: "$1.00" },
  { field: "Most for one data call", value: "$0.05" },
  { field: "Wait between orders, in seconds", value: "60" },
  { field: "Ask the owner above", value: "$0.00, so every order" },
  { field: "One side per market", value: "yes" },
  { field: "Cut back after losing", value: "$5.00, halve the size" },
  { field: "Cut back after losing", value: "$10.00, stop trading" },
];

const rise: Variants = {
  hidden: { opacity: 0, y: 22 },
  show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] } },
};

const flat: Variants = { hidden: { opacity: 1, y: 0 }, show: { opacity: 1, y: 0 } };

export function RulebookSheet() {
  const shouldReduce = useCalmEntrance();
  const enter = shouldReduce ? flat : rise;

  return (
    <section className="relative isolate w-full overflow-hidden bg-[#080808] py-[clamp(6rem,20vh,13rem)]">
      <div className="film-grain absolute z-10" aria-hidden />

      <div className="relative z-20 grid grid-cols-12 gap-y-[clamp(2.5rem,6vh,4rem)] px-[clamp(1.25rem,5vw,5rem)]">
        <motion.div
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.5 }}
          variants={{ hidden: {}, show: { transition: { staggerChildren: shouldReduce ? 0 : 0.08 } } }}
          className="col-span-12 md:col-span-4 md:pt-[6vh]"
        >
          <motion.p
            variants={enter}
            className="flex items-center gap-3 font-mono text-[0.72rem] uppercase tracking-[0.22em] text-ink/55"
          >
            <span className="block size-2 rounded-[2px] bg-amber" />
            Written once, by the owner
          </motion.p>

          <motion.h2
            variants={enter}
            className="mt-[clamp(1rem,3vh,1.75rem)] font-display font-extrabold text-ink"
            style={{ fontSize: "clamp(2.25rem, 6vw, 5rem)", letterSpacing: "-0.035em", lineHeight: 0.95 }}
          >
            The rulebook.
          </motion.h2>

          <motion.p
            variants={enter}
            className="mt-[clamp(1.25rem,3vh,2rem)] max-w-[34ch] font-mono text-[0.8rem] leading-[1.7] text-amber"
          >
            Enforced in code before every payment and every order. The model never holds the
            controls.
          </motion.p>
        </motion.div>

        <motion.article
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.25 }}
          variants={{
            hidden: {},
            show: { transition: { staggerChildren: shouldReduce ? 0 : 0.055, delayChildren: shouldReduce ? 0 : 0.1 } },
          }}
          className="col-span-12 border border-ink/12 bg-[#0d0d0d] px-[clamp(1.25rem,3vw,2.75rem)] py-[clamp(1.75rem,4vh,2.75rem)] shadow-[0_50px_120px_-60px_rgba(0,0,0,0.9)] md:col-span-7 md:col-start-6 md:-mt-[4vh] md:rotate-[-1.1deg]"
          style={{ borderRadius: "10px" }}
        >
          <motion.header
            variants={enter}
            className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-b border-ink/12 pb-[clamp(0.75rem,2vh,1.25rem)]"
          >
            <h3 className="font-display text-[1.25rem] font-medium tracking-[-0.02em] text-ink">
              Olai starter rulebook
            </h3>
            <span className="font-mono text-[0.7rem] uppercase tracking-[0.2em] text-ink/55">
              version 1
            </span>
          </motion.header>

          <dl className="mt-[clamp(0.5rem,1.5vh,1rem)]">
            {clauses.map((clause) => (
              <motion.div
                key={`${clause.field} ${clause.value}`}
                variants={enter}
                className="group border-b border-ink/[0.06] py-[clamp(0.5rem,1.2vh,0.8rem)] transition-colors duration-300 last:border-b-0 hover:border-amber/40"
              >
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <dt className="font-body text-[0.95rem] text-ink/60 transition-colors duration-300 group-hover:text-ink">
                    {clause.field}
                  </dt>
                  <span className="h-px min-w-6 flex-1 self-center bg-ink/12" aria-hidden />
                  <dd className="font-mono text-[0.85rem] text-ink transition-colors duration-300 group-hover:text-amber">
                    {clause.value}
                  </dd>
                </div>
                {clause.note ? (
                  <dd className="mt-1.5 max-w-[44ch] font-body text-[0.8rem] leading-[1.5] text-ink/55">
                    {clause.note}
                  </dd>
                ) : null}
              </motion.div>
            ))}
          </dl>
        </motion.article>
      </div>
    </section>
  );
}
