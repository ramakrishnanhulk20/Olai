"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { NavEntry, NavItem } from "@/lib/docs/content";

function matches(item: NavItem, query: string): boolean {
  return item.title.toLowerCase().includes(query);
}

function NavLink({
  item,
  current,
  onNavigate,
}: {
  item: NavItem;
  current: boolean;
  onNavigate: () => void;
}) {
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={current ? "page" : undefined}
      className={`docs-nav-link${current ? " is-current" : ""}`}
    >
      <span className="docs-nav-mark" aria-hidden />
      <span className="min-w-0">{item.title}</span>
    </Link>
  );
}

export function DocsSidebar({
  nav,
  pathname,
  query,
  onNavigate,
}: {
  nav: NavEntry[];
  pathname: string;
  query: string;
  onNavigate: () => void;
}) {
  const needle = query.trim().toLowerCase();
  const [closed, setClosed] = useState<string[]>([]);

  const filtered = useMemo(() => {
    if (needle.length === 0) return nav;
    return nav
      .map((entry) => {
        if (entry.kind === "page") return matches(entry.item, needle) ? entry : null;
        const items = entry.items.filter((item) => matches(item, needle));
        if (items.length === 0 && !entry.title.toLowerCase().includes(needle)) return null;
        return { ...entry, items: items.length > 0 ? items : entry.items };
      })
      .filter((entry): entry is NavEntry => entry !== null);
  }, [nav, needle]);

  if (filtered.length === 0) {
    return (
      <p className="px-4 py-6 font-mono text-[0.72rem] uppercase tracking-[0.16em] text-ink/35">
        No page by that name
      </p>
    );
  }

  return (
    <nav aria-label="Documentation" className="flex flex-col gap-1 px-3 pb-16 pt-5">
      {filtered.map((entry) => {
        if (entry.kind === "page") {
          return (
            <NavLink
              key={entry.item.href}
              item={entry.item}
              current={pathname === entry.item.href}
              onNavigate={onNavigate}
            />
          );
        }

        const holdsCurrent = entry.items.some((item) => item.href === pathname);
        // A search or the page you are reading always wins over a folded group.
        const open = needle.length > 0 || holdsCurrent || !closed.includes(entry.id);

        return (
          <section key={entry.id} className="mt-4 first:mt-1">
            <button
              type="button"
              aria-expanded={open}
              onClick={() =>
                setClosed((previous) =>
                  previous.includes(entry.id)
                    ? previous.filter((id) => id !== entry.id)
                    : [...previous, entry.id],
                )
              }
              className="docs-group-head"
            >
              <span>{entry.title}</span>
              <svg viewBox="0 0 12 12" aria-hidden className={`docs-chevron${open ? " is-open" : ""}`}>
                <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
              </svg>
            </button>

            {open ? (
              <div className="mt-1 flex flex-col gap-0.5">
                {entry.items.map((item) => (
                  <NavLink
                    key={item.href}
                    item={item}
                    current={pathname === item.href}
                    onNavigate={onNavigate}
                  />
                ))}
              </div>
            ) : null}
          </section>
        );
      })}
    </nav>
  );
}
