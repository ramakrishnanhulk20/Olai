"use client";

import { motion, useReducedMotion, type Variants } from "framer-motion";

// Next inlines NEXT_PUBLIC_ values at build time. Unset, they read undefined
// here, so the fallback is what keeps the anchor from rendering href="undefined".
const links: Array<{ label: string; href: string }> = [
  { label: "Open the desk", href: "/app" },
  { label: "Documentation", href: "/docs" },
  { label: "GitHub", href: process.env.NEXT_PUBLIC_REPO_URL ?? "#" },
];

const rise: Variants = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] } },
};

const flat: Variants = { hidden: { opacity: 1, y: 0 }, show: { opacity: 1, y: 0 } };

export function StoryFooter() {
  const shouldReduce = useReducedMotion() ?? false;
  const enter = shouldReduce ? flat : rise;

  return (
    <footer className="relative isolate w-full overflow-hidden border-t border-ink/10 bg-[#060606] px-[clamp(1.25rem,5vw,5rem)] py-[clamp(3rem,10vh,6rem)]">
      <div className="film-grain absolute z-10" aria-hidden />

      <motion.div
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, amount: 0.4 }}
        variants={{ hidden: {}, show: { transition: { staggerChildren: shouldReduce ? 0 : 0.08 } } }}
        className="relative z-20 flex flex-col gap-[clamp(2rem,6vh,3.5rem)] md:flex-row md:items-end md:justify-between"
      >
        <motion.a
          variants={enter}
          href="/"
          className="group flex items-center gap-3 font-display text-[clamp(1.75rem,4vw,2.75rem)] font-extrabold tracking-[-0.03em] text-ink transition-opacity duration-300 hover:opacity-70"
        >
          <span className="block size-[0.5em] rounded-[2px] bg-amber transition-transform duration-300 group-hover:rotate-45" />
          Olai
        </motion.a>

        <motion.nav variants={enter} className="flex flex-wrap gap-x-8 gap-y-3">
          {links.map((link) => (
            <a
              key={link.label}
              href={link.href}
              className="relative font-body text-[1rem] text-ink/70 transition-colors duration-300 after:absolute after:-bottom-1 after:left-0 after:h-px after:w-0 after:bg-amber after:transition-all after:duration-300 hover:text-ink hover:after:w-full"
            >
              {link.label}
            </a>
          ))}
        </motion.nav>
      </motion.div>

      <motion.p
        initial={shouldReduce ? undefined : { opacity: 0 }}
        whileInView={shouldReduce ? undefined : { opacity: 1 }}
        viewport={{ once: true, amount: 0.4 }}
        transition={{ duration: 0.8, delay: 0.15 }}
        className="relative z-20 mt-[clamp(2.5rem,7vh,4rem)] font-mono text-[0.72rem] uppercase tracking-[0.18em] text-ink/35"
      >
        Self-audited. Threat model and executed attack scripts in the repository.
      </motion.p>
    </footer>
  );
}
