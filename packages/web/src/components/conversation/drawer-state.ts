import type { DrawerTab } from "./drawer";

/**
 * Whether the details drawer is open, and on which tab.
 *
 * localStorage, because the owner who works with the receipt open should find it
 * open next time, and it is read through useSyncExternalStore so storage is
 * treated as what it is: an outside system React subscribes to rather than state
 * it owns. A browser that has never opened it has nothing stored, so the first
 * visit is the conversation on its own.
 */

const KEY = "olai.desk.drawer";

export type DrawerState = "closed" | DrawerTab;

const listeners = new Set<() => void>();

/** A browser with storage switched off still gets one working page view. */
let held: DrawerState = "closed";

function notify(): void {
  for (const listener of [...listeners]) {
    listener();
  }
}

export function subscribeDrawer(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

export function readDrawer(): DrawerState {
  try {
    const saved = window.localStorage.getItem(KEY);
    if (saved === "rulebook" || saved === "wallet" || saved === "ledger") {
      return saved;
    }
    return "closed";
  } catch {
    return held;
  }
}

/** The server has no storage to read, so a first paint is always the conversation. */
export function closedOnServer(): DrawerState {
  return "closed";
}

export function writeDrawer(state: DrawerState): void {
  held = state;
  try {
    window.localStorage.setItem(KEY, state);
  } catch {
    // A browser with storage switched off still runs the desk for this page view.
  }
  notify();
}
