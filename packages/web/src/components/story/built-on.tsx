"use client";

import { motion, useReducedMotion, type Variants } from "framer-motion";

const tiles: Array<{ name: string; line: string; span: string; held?: boolean }> = [
  {
    name: "Agentic Wallet",
    line: "Olai previews the price and signs each payment through the wallet CLI, under the wallet's own daily limit, two real cents settled on BNB Smart Chain.",
    span: "md:col-span-4",
  },
  {
    name: "x402 and the Bazaar",
    line: "It searches the public B402 catalogue for a listing under its per-call cap, then answers the merchant's 402 on BNB Smart Chain.",
    span: "md:col-span-5",
  },
  {
    name: "The exchange API on an isolated sub-account",
    line: "Ticker, book, candles, balances and spot orders, with no withdrawal permission, proven on the spot testnet; a live sub-account needs a trade-only key.",
    span: "md:col-span-3",
  },
  {
    name: "The Skills Hub",
    line: "Not called at runtime. The wallet skill's documentation is what the wallet wrapper was built from.",
    span: "md:col-span-5 md:col-start-2",
  },
  {
    name: "The MCP server",
    line: "The other door to the same reads and orders. Olai's client is coded and tested, and stays shut until the allowlist opens.",
    span: "md:col-span-5",
    held: true,
  },
];

const rise: Variants = {
  hidden: { opacity: 0, y: 26 },
  show: { opacity: 1, y: 0, transition: { duration: 0.8, ease: [0.16, 1, 0.3, 1] } },
};

const flat: Variants = { hidden: { opacity: 1, y: 0 }, show: { opacity: 1, y: 0 } };

export function BuiltOn() {
  const shouldReduce = useReducedMotion() ?? false;
  const enter = shouldReduce ? flat : rise;

  return (
    <section className="relative isolate w-full overflow-hidden bg-ground py-[clamp(6rem,18vh,12rem)]">
      <div className="film-grain absolute z-10" aria-hidden />

      <motion.div
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, amount: 0.25 }}
        variants={{ hidden: {}, show: { transition: { staggerChildren: shouldReduce ? 0 : 0.09 } } }}
        className="relative z-20 grid grid-cols-12 gap-x-[clamp(1rem,2vw,2.5rem)] gap-y-[clamp(2rem,5vh,3.5rem)] px-[clamp(1.25rem,5vw,5rem)]"
      >
        <motion.div variants={enter} className="col-span-12 md:col-span-7">
          <p className="flex items-center gap-3 font-mono text-[0.72rem] uppercase tracking-[0.22em] text-ink/45">
            <span className="block size-2 rounded-[2px] bg-amber" />
            What it runs on
          </p>
          <h2
            className="mt-[clamp(1rem,3vh,1.75rem)] font-display font-extrabold text-ink"
            style={{ fontSize: "clamp(2.25rem, 6vw, 5rem)", letterSpacing: "-0.035em", lineHeight: 0.95 }}
          >
            Built on Binance Agent OS.
          </h2>
        </motion.div>

        {tiles.map((tile) => (
          <motion.div
            key={tile.name}
            variants={enter}
            className={`col-span-12 border-t pt-[clamp(1rem,2.5vh,1.5rem)] transition-colors duration-500 ${tile.span} ${
              tile.held ? "border-ink/10 opacity-45 hover:opacity-80" : "border-ink/25 hover:border-amber"
            }`}
          >
            <h3 className="font-display text-[1.35rem] font-medium leading-[1.15] tracking-[-0.02em] text-ink">
              {tile.name}
            </h3>
            {tile.held ? (
              <p className="mt-2 font-mono text-[0.68rem] uppercase tracking-[0.18em] text-amber">
                held: Binance admits only listed agents today
              </p>
            ) : null}
            <p className="mt-3 max-w-[46ch] font-body text-[0.98rem] leading-[1.6] text-ink/60">
              {tile.line}
            </p>
          </motion.div>
        ))}
      </motion.div>
    </section>
  );
}
