"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { motion, useReducedMotion, type Variants } from "framer-motion";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import sample from "../../../public/ledger-sample.json";

interface LedgerRow {
  seq: number;
  ts: string;
  kind: string;
  actor: string;
  costUsd?: number;
  txHash?: string;
  hashPrefix: string;
  summary: string;
}

/**
 * Real lines, exported once from the running service by the owner. The landing page
 * never holds the owner token, so it reads this file instead of the ledger routes.
 */
const rows: LedgerRow[] = sample;

// The chain line is revealed after the last row, so it is one more step in the sequence.
const steps = rows.length + 1;

const rise: Variants = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.8, ease: [0.16, 1, 0.3, 1] } },
};

const flat: Variants = { hidden: { opacity: 1, y: 0 }, show: { opacity: 1, y: 0 } };

function money(amount: number): string {
  return `$${amount.toFixed(4)}`;
}

export function LedgerScroll() {
  const shouldReduce = useReducedMotion() ?? false;
  const enter = shouldReduce ? flat : rise;
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;

    gsap.registerPlugin(ScrollTrigger);
    const media = gsap.matchMedia();

    // Pinned only where there is room for the whole ledger and where motion is welcome.
    // Everywhere else the CSS default leaves every row already typed in.
    media.add("(min-width: 768px) and (prefers-reduced-motion: no-preference)", () => {
      const trigger = ScrollTrigger.create({
        trigger: section,
        start: "top top",
        end: "+=300%",
        pin: true,
        anticipatePin: 1,
        invalidateOnRefresh: true,
        onUpdate: (self) => {
          // The progress is a CSS variable, so the rows are revealed by the compositor
          // and React never renders while the page is moving.
          section.style.setProperty("--p", self.progress.toFixed(4));
        },
      });

      return () => {
        trigger.kill();
        section.style.removeProperty("--p");
      };
    });

    return () => media.revert();
  }, []);

  return (
    <section
      id="ledger"
      ref={sectionRef}
      className="ledger-stack relative isolate flex w-full flex-col justify-center overflow-hidden bg-ground px-[clamp(1.25rem,5vw,5rem)] py-[clamp(5rem,14vh,8rem)] md:h-[100svh] md:py-0"
      style={{ "--rows": steps } as CSSProperties}
    >
      <div
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(60rem 40rem at 12% 8%, rgba(245,165,36,0.12), rgba(10,10,10,0) 66%)",
        }}
        aria-hidden
      />
      <div className="film-grain absolute z-10" aria-hidden />

      <motion.header
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, amount: 0.35 }}
        variants={{ hidden: {}, show: { transition: { staggerChildren: shouldReduce ? 0 : 0.08 } } }}
        className="relative z-20 grid grid-cols-12 items-end gap-y-[clamp(1rem,2.5vh,1.75rem)]"
      >
        <motion.div variants={enter} className="col-span-12 md:col-span-5">
          <p className="flex items-center gap-3 font-mono text-[0.72rem] uppercase tracking-[0.22em] text-ink/45">
            <span className="block size-2 rounded-[2px] bg-amber" />
            captured from a live run
          </p>
          <h2
            className="mt-[clamp(0.75rem,2vh,1.25rem)] font-display font-extrabold text-ink"
            style={{ fontSize: "clamp(2.25rem, 6vw, 5rem)", letterSpacing: "-0.035em", lineHeight: 0.95 }}
          >
            The ledger.
          </h2>
        </motion.div>

        <motion.p
          variants={enter}
          className="col-span-12 max-w-[52ch] font-body text-[1rem] leading-[1.6] text-ink/65 md:col-span-6 md:col-start-7 md:pb-[1.2vh]"
        >
          Every cent, every rule verdict, every order, hash-chained. Edit a line and the chain
          breaks.
        </motion.p>
      </motion.header>

      <ol className="relative z-20 mt-[clamp(2rem,5vh,3.5rem)] border-t border-ink/10 font-body text-[clamp(0.72rem,1.45vh,0.9rem)]">
        {rows.map((row, index) => {
          const settlement = row.txHash;
          return (
            <li
              key={row.seq}
              style={{ "--i": index } as CSSProperties}
              className={
                "ledger-row grid grid-cols-[2.5rem_1fr] items-baseline gap-x-3 gap-y-1 border-b border-ink/[0.06] py-[0.6vh] md:grid-cols-[3rem_9.5rem_1fr_5rem_6.5rem]" +
                (settlement ? " ledger-row--settled" : "")
              }
            >
              <span className="font-mono text-ink/35">{String(row.seq).padStart(2, "0")}</span>
              <span className="col-start-2 font-mono text-[0.9em] uppercase tracking-[0.12em] text-ink/50">
                {row.kind}
              </span>
              <span className="col-span-2 col-start-1 min-w-0 md:col-span-1 md:col-start-3">
                <span className="ledger-line relative inline-flex min-w-0 max-w-full">
                  <span className="ledger-type truncate text-ink/85">{row.summary}</span>
                  <span className="ledger-caret" aria-hidden />
                </span>
              </span>
              <span className="col-start-2 font-mono text-amber md:col-start-4 md:text-right">
                {typeof row.costUsd === "number" ? money(row.costUsd) : ""}
              </span>
              {settlement ? (
                <a
                  href={`https://bscscan.com/tx/${settlement}`}
                  target="_blank"
                  rel="noreferrer"
                  className="col-start-2 font-mono text-amber underline decoration-amber/40 underline-offset-4 transition-colors duration-300 hover:decoration-amber md:col-start-5 md:text-right"
                >
                  {settlement.slice(0, 10)}
                </a>
              ) : (
                <span className="col-start-2 font-mono text-ink/25 md:col-start-5 md:text-right">
                  {row.hashPrefix}
                </span>
              )}
            </li>
          );
        })}

        <li
          style={{ "--i": rows.length } as CSSProperties}
          className="ledger-row flex flex-wrap items-baseline gap-x-3 py-[1vh] font-mono text-amber"
        >
          <span className="block size-2 rounded-[2px] bg-amber" aria-hidden />
          <span className="ledger-line relative inline-flex min-w-0 max-w-full">
            <span className="ledger-type truncate">{rows.length} lines captured, chain verified</span>
            <span className="ledger-caret" aria-hidden />
          </span>
        </li>
      </ol>
    </section>
  );
}
