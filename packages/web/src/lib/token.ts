/**
 * Where the owner's token lives in the browser.
 *
 * sessionStorage, so it dies with the tab and never rides along on a request
 * the owner did not make. It is read straight into an Authorization header and
 * never put in a URL, a cookie, or a React key.
 *
 * The desk reads it through useSyncExternalStore, so storage is treated as what
 * it is: an outside system React subscribes to rather than state it owns.
 */

const KEY = "olai.owner-token";

const listeners = new Set<() => void>();

/** A browser with storage switched off still gets one working page view. */
let held: string | null = null;

function notify(): void {
  for (const listener of [...listeners]) {
    listener();
  }
}

export function subscribeToken(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

export function readToken(): string | null {
  try {
    return window.sessionStorage.getItem(KEY) ?? held;
  } catch {
    return held;
  }
}

/** There is no token on the server, so the gate is what a first paint shows. */
export function noToken(): null {
  return null;
}

export function writeToken(token: string): void {
  held = token;
  try {
    window.sessionStorage.setItem(KEY, token);
  } catch {
    // A browser with storage switched off still runs the desk for this page view.
  }
  notify();
}

export function clearToken(): void {
  held = null;
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    // Nothing to clear if the store refused to hold it in the first place.
  }
  notify();
}
