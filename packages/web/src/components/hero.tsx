"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion, type Variants } from "framer-motion";
import { getHealth } from "@/lib/api";

const rise: Variants = {
  hidden: { opacity: 0, y: 24 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.85, ease: [0.16, 1, 0.3, 1] },
  },
};

const still: Variants = {
  hidden: { opacity: 0, scale: 1.06 },
  show: { opacity: 1, scale: 1, transition: { duration: 1.6, ease: [0.16, 1, 0.3, 1] } },
};

type ServiceStatus = "CHECKING" | "LIVE" | "DRY RUN" | "STOPPED" | "OFFLINE";

function dotFor(status: ServiceStatus): string {
  if (status === "STOPPED" || status === "OFFLINE") return "bg-bad";
  if (status === "LIVE") return "bg-ok";
  return "bg-amber";
}

/**
 * The header label is the running service talking, not a word typed into the page.
 * Health is the only route the landing page is allowed to call, because it is the
 * only one that does not need the owner token.
 */
function useServiceStatus(): ServiceStatus {
  const [status, setStatus] = useState<ServiceStatus>("CHECKING");

  useEffect(() => {
    let live = true;
    const controller = new AbortController();

    const read = async () => {
      try {
        const health = await getHealth(controller.signal);
        if (!live) return;
        setStatus(health.killed ? "STOPPED" : health.dryRun ? "DRY RUN" : "LIVE");
      } catch {
        if (live) setStatus("OFFLINE");
      }
    };

    void read();
    const timer = window.setInterval(() => void read(), 15_000);

    return () => {
      live = false;
      controller.abort();
      window.clearInterval(timer);
    };
  }, []);

  return status;
}

export function Hero() {
  const shouldReduce = useReducedMotion() ?? false;
  const stillRef = useRef<HTMLDivElement>(null);
  const status = useServiceStatus();

  useEffect(() => {
    if (shouldReduce) return;
    const node = stillRef.current;
    if (!node) return;

    // The still is written to as a CSS variable inside a frame loop, so scrolling never
    // re-renders React.
    let frame = requestAnimationFrame(function tick() {
      node.style.setProperty("--hero-shift", `${(window.scrollY * 0.4).toFixed(2)}px`);
      frame = requestAnimationFrame(tick);
    });

    return () => cancelAnimationFrame(frame);
  }, [shouldReduce]);

  const container: Variants = {
    hidden: {},
    show: { transition: { staggerChildren: shouldReduce ? 0 : 0.08, delayChildren: shouldReduce ? 0 : 0.2 } },
  };

  const enter = shouldReduce
    ? ({ hidden: { opacity: 1, y: 0 }, show: { opacity: 1, y: 0 } } satisfies Variants)
    : rise;

  return (
    <section className="relative isolate min-h-[100svh] w-full overflow-hidden bg-ground">
      {/* SWAP: hero image. Until Ram hands over the still, the light source is generated here. */}
      <motion.div
        ref={stillRef}
        variants={shouldReduce ? undefined : still}
        initial={shouldReduce ? undefined : "hidden"}
        animate={shouldReduce ? undefined : "show"}
        className="hero-still absolute inset-0 -z-10"
        aria-hidden
      >
        <div className="absolute inset-0 bg-ground" />
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(58rem 46rem at 74% 14%, rgba(245,165,36,0.30), rgba(245,165,36,0.07) 42%, rgba(10,10,10,0) 72%)",
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(16rem 14rem at 76% 11%, rgba(245,165,36,0.42), rgba(245,165,36,0) 70%)",
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(120% 90% at 10% 100%, rgba(0,0,0,0.85), rgba(0,0,0,0) 60%)",
          }}
        />
      </motion.div>

      <div className="film-grain absolute z-20" aria-hidden />

      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-[72%]"
        style={{
          background:
            "linear-gradient(to top, #0a0a0a 8%, rgba(10,10,10,0.88) 34%, rgba(10,10,10,0.35) 68%, rgba(10,10,10,0) 100%)",
        }}
        aria-hidden
      />

      <motion.header
        variants={container}
        initial="hidden"
        animate="show"
        className="absolute inset-x-0 top-0 z-30 flex items-center justify-between px-[clamp(1.25rem,5vw,5rem)] pt-[clamp(1.25rem,3.5vh,2.5rem)]"
      >
        <motion.a
          variants={enter}
          href="/"
          className="group flex items-center gap-3 font-display text-[1.05rem] font-medium tracking-[-0.02em] text-ink transition-opacity duration-300 hover:opacity-70"
        >
          <span className="block size-2.5 rounded-[2px] bg-amber transition-transform duration-300 group-hover:rotate-45" />
          Olai
        </motion.a>

        <motion.span
          variants={enter}
          title="Read from the service health route"
          className="flex items-center gap-2 rounded-control border border-ink/20 px-3 py-1.5 font-mono text-[0.7rem] uppercase tracking-[0.18em] text-ink/60 transition-colors duration-300 hover:border-ink/45 hover:text-ink"
        >
          <span className={"block size-1.5 rounded-[1px] " + dotFor(status)} aria-hidden />
          {status}
        </motion.span>
      </motion.header>

      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="relative z-30 flex min-h-[100svh] flex-col justify-end px-[clamp(1.25rem,5vw,5rem)] pb-[clamp(2.5rem,8vh,4.5rem)]"
      >
        <motion.p
          variants={enter}
          className="flex flex-wrap items-center gap-x-3 gap-y-2 font-mono text-[0.8rem] uppercase leading-relaxed tracking-[0.16em] text-amber"
        >
          <span className="block size-2 shrink-0 rounded-[2px] bg-amber" />
          <span className="min-w-0 flex-1 sm:flex-none">
            Binance Agent OS · x402 · BNB Smart Chain · One cent per call
          </span>
        </motion.p>

        <div className="relative mt-[clamp(1rem,3vh,2rem)]">
          {/* The scrim edge the title crosses, so the type sits in front of the light and not on it. */}
          <div
            className="pointer-events-none absolute inset-x-[-100vw] top-[42%] -z-10 h-px bg-ink/15"
            aria-hidden
          />
          <motion.h1
            variants={enter}
            className="font-display font-extrabold text-ink"
            style={{
              fontSize: "clamp(3rem, 10vw, 9rem)",
              letterSpacing: "-0.04em",
              lineHeight: 0.9,
            }}
          >
            Olai
          </motion.h1>
        </div>

        <motion.p
          variants={enter}
          className="mt-[clamp(1rem,2.5vh,1.75rem)] max-w-[54ch] font-body text-[1.25rem] leading-[1.5] text-ink/75"
        >
          An analyst agent that buys its own intelligence a cent at a time, and trades only inside a
          written rulebook.
        </motion.p>

        <motion.div
          variants={enter}
          className="mt-[clamp(1.75rem,4vh,2.75rem)] flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4"
        >
          <motion.a
            href="/app"
            whileHover={shouldReduce ? undefined : { scale: 1.02 }}
            whileTap={shouldReduce ? undefined : { scale: 0.99 }}
            transition={{ type: "spring", stiffness: 420, damping: 28 }}
            className="rounded-control bg-amber px-7 py-3.5 text-center font-body text-[0.95rem] font-semibold text-ground transition-[filter,box-shadow] duration-300 hover:brightness-110 hover:shadow-[0_0_38px_-8px_rgba(245,165,36,0.65)]"
          >
            Open the desk
          </motion.a>

          <motion.a
            href="#ledger"
            whileHover={shouldReduce ? undefined : { scale: 1.02 }}
            whileTap={shouldReduce ? undefined : { scale: 0.99 }}
            transition={{ type: "spring", stiffness: 420, damping: 28 }}
            className="rounded-control border border-ink/35 px-7 py-3.5 text-center font-body text-[0.95rem] font-semibold text-ink transition-[color,border-color,background-color,filter] duration-300 hover:border-ink hover:bg-ink/5 hover:brightness-110"
          >
            Read the ledger
          </motion.a>
        </motion.div>
      </motion.div>
    </section>
  );
}
