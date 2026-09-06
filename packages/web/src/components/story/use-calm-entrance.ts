"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void): () => void {
  const list = window.matchMedia(QUERY);
  list.addEventListener("change", onChange);
  return () => list.removeEventListener("change", onChange);
}

/**
 * True when the reader has asked for less motion.
 *
 * The server has no media query to read, so it answers false and the first client
 * render answers false with it. That is what keeps the two sets of markup
 * identical; React reads the real setting on the pass straight after and the
 * section settles into its calm version before anything is scrolled into view.
 */
export function useCalmEntrance(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}
