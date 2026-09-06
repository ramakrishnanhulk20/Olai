"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import type { DocHeading } from "@/lib/docs/render";

export function DocsToc({ headings }: { headings: DocHeading[] }) {
  const shouldReduce = useReducedMotion() ?? false;
  const [active, setActive] = useState<string | null>(headings[0]?.id ?? null);

  useEffect(() => {
    const nodes = headings
      .map((heading) => document.getElementById(heading.id))
      .filter((node): node is HTMLElement => node !== null);
    if (nodes.length === 0) return;

    // The heading nearest above the top bar is the one being read.
    const pick = () => {
      let current = nodes[0];
      for (const node of nodes) {
        if (node.getBoundingClientRect().top <= 110) current = node;
      }
      setActive(current.id);
    };

    const observer = new IntersectionObserver(pick, {
      rootMargin: "-96px 0px -60% 0px",
      threshold: [0, 1],
    });
    for (const node of nodes) observer.observe(node);
    pick();

    return () => observer.disconnect();
  }, [headings]);

  if (headings.length === 0) return null;

  return (
    <motion.aside
      className="docs-toc"
      initial={shouldReduce ? undefined : { opacity: 0, y: 12 }}
      animate={shouldReduce ? undefined : { opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
    >
      <p className="docs-toc-head">On this page</p>
      <nav aria-label="On this page" className="flex flex-col">
        {headings.map((heading) => (
          <a
            key={heading.id}
            href={`#${heading.id}`}
            className={`docs-toc-link${heading.depth === 3 ? " is-deep" : ""}${
              active === heading.id ? " is-active" : ""
            }`}
          >
            {heading.text}
          </a>
        ))}
      </nav>
    </motion.aside>
  );
}
