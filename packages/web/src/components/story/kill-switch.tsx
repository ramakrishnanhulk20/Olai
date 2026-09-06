"use client";

import { motion, type Variants } from "framer-motion";
import { useCalmEntrance } from "./use-calm-entrance";

const rise: Variants = {
  hidden: { opacity: 0, y: 26 },
  show: { opacity: 1, y: 0, transition: { duration: 0.8, ease: [0.16, 1, 0.3, 1] } },
};

const flat: Variants = { hidden: { opacity: 1, y: 0 }, show: { opacity: 1, y: 0 } };

export function KillSwitch() {
  const shouldReduce = useCalmEntrance();
  const enter = shouldReduce ? flat : rise;

  const throwTo: Variants = {
    off: { x: 14, fill: "#1c1c1c" },
    on: {
      x: 170,
      fill: "#f5a524",
      transition: shouldReduce
        ? { duration: 0 }
        : { type: "spring", stiffness: 210, damping: 17, delay: 0.35 },
    },
  };

  const wake: Variants = {
    off: { opacity: 0 },
    on: { opacity: 1, transition: { duration: shouldReduce ? 0 : 0.5, delay: shouldReduce ? 0 : 0.5 } },
  };

  return (
    <section className="relative isolate w-full overflow-hidden bg-[#080808] py-[clamp(6rem,20vh,13rem)]">
      <div
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(40rem 30rem at 22% 62%, rgba(245,165,36,0.14), rgba(10,10,10,0) 70%)",
        }}
        aria-hidden
      />
      <div className="film-grain absolute z-10" aria-hidden />

      <div className="relative z-20 grid grid-cols-12 items-center gap-y-[clamp(2.5rem,7vh,4.5rem)] px-[clamp(1.25rem,5vw,5rem)]">
        <motion.svg
          viewBox="0 0 340 160"
          role="img"
          aria-label="A two-position switch thrown to stop"
          initial={shouldReduce ? "on" : "off"}
          whileInView="on"
          viewport={{ once: true, amount: 0.6 }}
          className="col-span-12 w-full max-w-[30rem] md:col-span-6 md:max-w-none md:-rotate-[5deg]"
        >
          <rect x="1" y="1" width="338" height="158" rx="12" fill="#0d0d0d" stroke="#f2efe8" strokeOpacity="0.12" />
          <rect x="10" y="10" width="320" height="140" rx="9" fill="#050505" />

          <motion.rect
            variants={wake}
            x="164"
            y="10"
            width="166"
            height="140"
            rx="9"
            fill="#f5a524"
            fillOpacity="0.07"
          />

          <motion.rect
            variants={throwTo}
            y="16"
            width="156"
            height="128"
            rx="8"
            stroke="#f2efe8"
            strokeOpacity="0.16"
          />

          <text x="52" y="86" className="font-mono" fontSize="17" letterSpacing="4" fill="#f2efe8" fillOpacity="0.28">
            RUN
          </text>
          <text x="226" y="86" className="font-mono" fontSize="17" letterSpacing="4" fill="#0a0a0a" fillOpacity="0.85">
            STOP
          </text>

          <motion.circle variants={wake} cx="310" cy="30" r="5" fill="#f5a524" />
        </motion.svg>

        <motion.div
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.5 }}
          variants={{ hidden: {}, show: { transition: { staggerChildren: shouldReduce ? 0 : 0.08 } } }}
          className="col-span-12 md:col-span-5 md:col-start-8 md:-mt-[10vh]"
        >
          <motion.p
            variants={enter}
            className="flex items-center gap-3 font-mono text-[0.72rem] uppercase tracking-[0.22em] text-ink/55"
          >
            <span className="block size-2 rounded-[2px] bg-amber" />
            One control the owner always holds
          </motion.p>

          <motion.h2
            variants={enter}
            className="mt-[clamp(1rem,3vh,1.75rem)] font-display font-extrabold text-ink"
            style={{ fontSize: "clamp(2.25rem, 6vw, 5rem)", letterSpacing: "-0.035em", lineHeight: 0.95 }}
          >
            The kill switch.
          </motion.h2>

          <motion.p
            variants={enter}
            className="mt-[clamp(1.25rem,3vh,2rem)] max-w-[52ch] font-body text-[1.0625rem] leading-[1.65] text-ink/70 md:text-[1.125rem]"
          >
            One click refuses every order and every payment until the owner resumes, mirrored by
            Binance&rsquo;s own emergency stop on the sub-account.
          </motion.p>

          <motion.p
            variants={enter}
            className="mt-[clamp(0.75rem,2vh,1.25rem)] max-w-[52ch] font-body text-[1.0625rem] leading-[1.65] text-ink/70 md:text-[1.125rem]"
          >
            It refuses everything that comes after the click; an order already sent to the exchange
            is not recalled.
          </motion.p>
        </motion.div>
      </div>
    </section>
  );
}
