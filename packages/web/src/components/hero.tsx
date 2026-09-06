"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useReducedMotion } from "framer-motion";
import { getHealth } from "@/lib/api";
import styles from "./hero.module.css";

type ServiceStatus = "CHECKING" | "LIVE" | "DRY RUN" | "STOPPED" | "NOT CONNECTED";

// Next replaces this at build time. A public build with no service behind it shows a
// recorded run rather than pinging an origin that is not there.
const SERVICE_CONFIGURED = (process.env.NEXT_PUBLIC_OLAI_API ?? "").length > 0;

const RECORDED = "RECORDED RUN";

function dotFor(status: ServiceStatus | typeof RECORDED): string {
  if (status === "STOPPED") return "bg-bad";
  if (status === "LIVE") return "bg-ok";
  if (status === "NOT CONNECTED" || status === RECORDED) return "bg-ink/45";
  return "bg-amber";
}

/**
 * The header label is the running service talking, not a word typed into the page.
 * Health is the only route the landing page is allowed to call, because it is the
 * only one that does not need the owner token. An unreachable service is reported
 * as not connected, in ink: red on the first screen would read as a broken product.
 */
function useServiceStatus(enabled: boolean): ServiceStatus {
  const [status, setStatus] = useState<ServiceStatus>("CHECKING");

  useEffect(() => {
    if (!enabled) return;

    let live = true;
    const controller = new AbortController();

    const read = async () => {
      try {
        const health = await getHealth(controller.signal);
        if (!live) return;
        setStatus(health.killed ? "STOPPED" : health.dryRun ? "DRY RUN" : "LIVE");
      } catch {
        if (live) setStatus("NOT CONNECTED");
      }
    };

    void read();
    const timer = window.setInterval(() => void read(), 15_000);

    return () => {
      live = false;
      controller.abort();
      window.clearInterval(timer);
    };
  }, [enabled]);

  return status;
}

export function Hero() {
  const shouldReduce = useReducedMotion() ?? false;
  const stillRef = useRef<HTMLDivElement>(null);
  const status = useServiceStatus(SERVICE_CONFIGURED);
  const label = SERVICE_CONFIGURED ? status : RECORDED;

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

  return (
    <section className="relative isolate min-h-[100svh] w-full overflow-hidden bg-ground">
      {/* SWAP: hero image. Until Ram hands over the still, the light source is generated here. */}
      <div ref={stillRef} className={`hero-still absolute inset-0 -z-10 ${styles.still}`} aria-hidden>
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
      </div>

      <div className="film-grain absolute z-20" aria-hidden />

      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-[72%]"
        style={{
          background:
            "linear-gradient(to top, #0a0a0a 8%, rgba(10,10,10,0.88) 34%, rgba(10,10,10,0.35) 68%, rgba(10,10,10,0) 100%)",
        }}
        aria-hidden
      />

      <header className="absolute inset-x-0 top-0 z-30 flex items-center justify-between px-[clamp(1.25rem,5vw,5rem)] pt-[clamp(1.25rem,3.5vh,2.5rem)]">
        <Link
          href="/"
          prefetch={false}
          style={{ animationDelay: "0.2s" }}
          className={`group flex items-center gap-3 font-display text-[1.05rem] font-medium tracking-[-0.02em] text-ink transition-opacity duration-300 hover:opacity-70 ${styles.enter}`}
        >
          <span className="block size-2.5 rounded-[2px] bg-amber transition-transform duration-300 group-hover:rotate-45" />
          Olai
        </Link>

        <span
          style={{ animationDelay: "0.28s" }}
          title={
            SERVICE_CONFIGURED
              ? "Read from the service health route"
              : "This build has no service behind it. The ledger below is a recorded run."
          }
          className={`flex items-center gap-2 rounded-control border border-ink/20 px-3 py-1.5 font-mono text-[0.7rem] uppercase tracking-[0.18em] text-ink/60 transition-colors duration-300 hover:border-ink/45 hover:text-ink ${styles.enter}`}
        >
          <span className={"block size-1.5 rounded-[1px] " + dotFor(label)} aria-hidden />
          {label}
        </span>
      </header>

      <div className="relative z-30 flex min-h-[100svh] flex-col justify-end px-[clamp(1.25rem,5vw,5rem)] pb-[clamp(2.5rem,8vh,4.5rem)]">
        <p
          style={{ animationDelay: "0.2s" }}
          className={`flex flex-wrap items-center gap-x-3 gap-y-2 font-mono text-[0.8rem] uppercase leading-relaxed tracking-[0.16em] text-amber ${styles.enter}`}
        >
          <span className="block size-2 shrink-0 rounded-[2px] bg-amber" />
          <span className="min-w-0 flex-1 sm:flex-none">
            Binance Agent OS · x402 · BNB Smart Chain · One cent per call
          </span>
        </p>

        <div className="relative mt-[clamp(1rem,3vh,2rem)]">
          {/* The scrim edge the title crosses, so the type sits in front of the light and not on it. */}
          <div
            className="pointer-events-none absolute inset-x-[-100vw] top-[42%] -z-10 h-px bg-ink/15"
            aria-hidden
          />
          <h1
            className={`font-display font-extrabold text-ink ${styles.enter}`}
            style={{
              fontSize: "clamp(3.75rem, 10vw, 9rem)",
              letterSpacing: "-0.04em",
              lineHeight: 0.9,
              animationDelay: "0.28s",
            }}
          >
            Olai
          </h1>
        </div>

        <p
          style={{ animationDelay: "0.36s" }}
          className={`mt-[clamp(1rem,2.5vh,1.75rem)] max-w-[92ch] font-body text-[1.0625rem] leading-[1.5] text-ink/75 sm:text-[1.25rem] ${styles.enter}`}
        >
          An analyst agent for one Binance sub-account. It buys the data it needs a cent at a time
          from its own Binance wallet, trades only inside a rulebook you write, and keeps a receipt
          for both.
        </p>

        <div
          style={{ animationDelay: "0.44s" }}
          className={`mt-[clamp(1.75rem,4vh,2.75rem)] flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4 ${styles.enter}`}
        >
          <a
            href="/app"
            className="rounded-control bg-amber px-7 py-3.5 text-center font-body text-[0.95rem] font-semibold text-ground transition duration-300 hover:scale-[1.02] hover:brightness-110 hover:shadow-[0_0_38px_-8px_rgba(245,165,36,0.65)] active:scale-[0.99]"
          >
            Open the desk
          </a>

          <a
            href="#ledger"
            className="rounded-control border border-ink/35 px-7 py-3.5 text-center font-body text-[0.95rem] font-semibold text-ink transition duration-300 hover:scale-[1.02] hover:border-ink hover:bg-ink/5 hover:brightness-110 active:scale-[0.99]"
          >
            Read the ledger
          </a>
        </div>
      </div>
    </section>
  );
}
