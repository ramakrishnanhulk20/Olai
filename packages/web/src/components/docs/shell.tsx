"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { NavEntry } from "@/lib/docs/content";
import { DocsSidebar } from "./sidebar";
import { DocsSearch } from "./search";

export function DocsShell({ nav, children }: { nav: NavEntry[]; children: ReactNode }) {
  const pathname = usePathname();
  const shouldReduce = useReducedMotion() ?? false;
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative min-h-svh bg-ground">
      <div className="docs-grain" aria-hidden>
        <span className="film-grain" />
      </div>

      <div className="relative z-10">
        <header className="docs-topbar">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-expanded={open}
            aria-label="Open the page list"
            className="docs-drawer-button lg:hidden"
          >
            <span aria-hidden />
            <span aria-hidden />
            <span aria-hidden />
          </button>

          <Link href="/" className="docs-wordmark">
            <span className="docs-wordmark-mark" aria-hidden />
            Olai
          </Link>

          <span className="docs-topbar-tag">Docs</span>

          <div className="ml-auto flex items-center gap-3">
            <div className="hidden w-[14rem] md:block xl:w-[17rem]">
              <DocsSearch id="docs-filter-bar" value={query} onChange={setQuery} />
            </div>
            <Link href="/app" className="docs-desk-link">
              Open the desk
            </Link>
          </div>
        </header>

        <div className="mx-auto flex w-full max-w-[104rem] items-start">
          <aside className="docs-rail hidden lg:block" data-lenis-prevent>
            <DocsSidebar nav={nav} pathname={pathname} query={query} onNavigate={() => undefined} />
          </aside>

          <div className="min-w-0 flex-1">{children}</div>
        </div>
      </div>

      <AnimatePresence>
        {open ? (
          <motion.div
            key="drawer"
            className="fixed inset-0 z-50 lg:hidden"
            initial={shouldReduce ? undefined : { opacity: 0 }}
            animate={shouldReduce ? undefined : { opacity: 1 }}
            exit={shouldReduce ? undefined : { opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <button
              type="button"
              aria-label="Close the page list"
              onClick={() => setOpen(false)}
              className="absolute inset-0 h-full w-full bg-ground/80 backdrop-blur-sm"
            />
            <motion.div
              className="docs-drawer"
              data-lenis-prevent
              initial={shouldReduce ? undefined : { x: "-100%" }}
              animate={shouldReduce ? undefined : { x: 0 }}
              exit={shouldReduce ? undefined : { x: "-100%" }}
              transition={{ duration: 0.34, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="flex items-center gap-3 border-b border-ink/10 px-4 py-3">
                <span className="font-mono text-[0.62rem] uppercase tracking-[0.2em] text-ink/40">Docs</span>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="ml-auto font-mono text-[0.68rem] uppercase tracking-[0.16em] text-ink/45 transition-colors duration-300 hover:text-ink"
                >
                  Close
                </button>
              </div>
              <div className="px-3 pt-3">
                <DocsSearch id="docs-filter-drawer" value={query} onChange={setQuery} />
              </div>
              <DocsSidebar
                nav={nav}
                pathname={pathname}
                query={query}
                onNavigate={() => setOpen(false)}
              />
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
