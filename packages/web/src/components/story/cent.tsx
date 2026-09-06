"use client";

import { useEffect, useRef } from "react";
import { motion, useInView, useReducedMotion, type Variants } from "framer-motion";

const rise: Variants = {
  hidden: { opacity: 0, y: 28 },
  show: { opacity: 1, y: 0, transition: { duration: 0.85, ease: [0.16, 1, 0.3, 1] } },
};

const flat: Variants = { hidden: { opacity: 1, y: 0 }, show: { opacity: 1, y: 0 } };

// Two settlements of this product's own data payments, on BNB Smart Chain.
const settlements = [
  "0xd31a8a75f6df501e1aba6166b248a2a8a1e928a52c401fae9465181082ad9a43",
  "0xb495d3c91ebff850ce01e19dc8826e8adf433028b3516f48a8ad04b1522ce9bb",
];

export function Cent() {
  const shouldReduce = useReducedMotion() ?? false;
  const enter = shouldReduce ? flat : rise;

  const numeralRef = useRef<HTMLSpanElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const inView = useInView(frameRef, { once: true, amount: 0.45 });

  useEffect(() => {
    const node = numeralRef.current;
    if (!node || shouldReduce) return;

    // The count writes into one text node inside a frame loop, so the price ticks
    // without React rendering fourteen hundred times on the way up.
    if (!inView) {
      node.textContent = "$0.0000";
      return;
    }

    const started = performance.now();
    const runFor = 1500;

    let frame = requestAnimationFrame(function tick(now: number) {
      const t = Math.min(1, (now - started) / runFor);
      const eased = 1 - Math.pow(1 - t, 3);
      node.textContent = t < 1 ? `$${(0.01 * eased).toFixed(4)}` : "$0.01";
      if (t < 1) frame = requestAnimationFrame(tick);
    });

    return () => cancelAnimationFrame(frame);
  }, [inView, shouldReduce]);

  return (
    <section className="relative isolate w-full overflow-hidden bg-ground py-[clamp(6rem,20vh,13rem)]">
      <div
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(46rem 34rem at 84% 42%, rgba(245,165,36,0.16), rgba(10,10,10,0) 68%)",
        }}
        aria-hidden
      />
      <div className="film-grain absolute z-10" aria-hidden />

      <div
        ref={frameRef}
        className="relative z-20 grid grid-cols-12 items-center gap-y-[clamp(2.5rem,7vh,4.5rem)] px-[clamp(1.25rem,5vw,5rem)]"
      >
        <motion.div
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.4 }}
          variants={{ hidden: {}, show: { transition: { staggerChildren: shouldReduce ? 0 : 0.08 } } }}
          className="col-span-12 md:col-span-5"
        >
          <motion.p
            variants={enter}
            className="flex items-center gap-3 font-mono text-[0.72rem] uppercase tracking-[0.22em] text-ink/45"
          >
            <span className="block size-2 rounded-[2px] bg-amber" />
            What a call costs
          </motion.p>

          <motion.h2
            variants={enter}
            className="mt-[clamp(1rem,3vh,1.75rem)] font-display font-extrabold text-ink"
            style={{ fontSize: "clamp(2.25rem, 6vw, 5rem)", letterSpacing: "-0.035em", lineHeight: 0.95 }}
          >
            The cent.
          </motion.h2>

          <motion.p
            variants={enter}
            className="mt-[clamp(1.25rem,3vh,2rem)] max-w-[62ch] font-body text-[1.0625rem] leading-[1.65] text-ink/70 md:text-[1.125rem]"
          >
            Olai pays for market intelligence per call from a Binance Agentic Wallet over x402, no
            subscriptions, no API keys to hand out, and every payment settles on BNB Smart Chain with
            a hash it keeps.
          </motion.p>

          <motion.p
            variants={enter}
            className="mt-[clamp(0.75rem,2vh,1.25rem)] max-w-[62ch] font-body text-[1.0625rem] leading-[1.65] text-ink/70 md:text-[1.125rem]"
          >
            A desk that runs one of these pays for the data it actually used that day, not for a
            subscription it might not open.
          </motion.p>

          <motion.div variants={enter} className="mt-[clamp(1.5rem,4vh,2.5rem)]">
            <p className="flex items-center gap-3 font-mono text-[0.72rem] leading-[1.5] tracking-[0.06em] text-ink/45">
              <span className="block size-2 shrink-0 rounded-[2px] bg-amber" />
              Two of Olai&rsquo;s own cents, settled on BNB Smart Chain:
            </p>
            <div className="mt-3 flex flex-wrap gap-x-7 gap-y-2 pl-[1.25rem]">
              {settlements.map((hash) => (
                <a
                  key={hash}
                  href={`https://bscscan.com/tx/${hash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-[0.8rem] text-amber underline decoration-amber/40 underline-offset-4 transition-colors duration-300 hover:decoration-amber"
                >
                  {hash.slice(0, 10)}
                </a>
              ))}
            </div>
          </motion.div>
        </motion.div>

        <motion.div
          initial={shouldReduce ? undefined : { opacity: 0, y: 40 }}
          whileInView={shouldReduce ? undefined : { opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
          className="col-span-12 md:col-span-7 md:-mt-[6vh] md:pl-[6%]"
        >
          <span
            ref={numeralRef}
            className="block font-display font-extrabold text-ink tabular-nums"
            style={{
              fontSize: "clamp(4rem, 14vw, 12rem)",
              letterSpacing: "-0.055em",
              lineHeight: 0.82,
            }}
          >
            $0.01
          </span>
        </motion.div>
      </div>
    </section>
  );
}
