import { API_BASE, type LedgerEntry, type Proposal } from "./api";

/**
 * The live feed, read with fetch.
 *
 * EventSource cannot send an Authorization header, and the owner token is not
 * allowed anywhere near a URL, so the stream is a plain fetch whose body is
 * read frame by frame. Nothing here is authoritative: a browser that misses an
 * event backfills from the ledger, which is what onOpen is for.
 */

export type BrainEvent =
  | { type: "thinking"; text: string }
  | { type: "tool"; name: string; input: unknown }
  | { type: "tool.result"; name: string; summary: string }
  | { type: "text"; text: string }
  | { type: "proposal"; proposal: Proposal };

export interface OwnerEvent {
  type: string;
  sessionId?: string;
  at: string;
  data: unknown;
}

export type StreamStatus = "connecting" | "live" | "retrying";

export interface StreamHandlers {
  onBrain: (sessionId: string | undefined, event: BrainEvent) => void;
  onLedger: (entry: LedgerEntry) => void;
  onStatus: (status: StreamStatus, detail?: string) => void;
  /** Fires every time the stream comes up, so the caller can backfill what it missed. */
  onOpen: () => void;
  onUnauthorized: () => void;
}

const FIRST_RETRY_MS = 1000;
const MAX_RETRY_MS = 15_000;

const brainTypes = new Set(["thinking", "tool", "tool.result", "text", "proposal"]);

/** Opens the stream and keeps it open. Call the returned function to stop. */
export function openEventStream(token: string, handlers: StreamHandlers): () => void {
  const controller = new AbortController();
  let stopped = false;
  let wait = FIRST_RETRY_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const run = async (): Promise<void> => {
    while (!stopped) {
      handlers.onStatus("connecting");

      try {
        const response = await fetch(new URL("api/events", `${API_BASE}/`), {
          headers: { Authorization: `Bearer ${token}`, Accept: "text/event-stream" },
          signal: controller.signal,
          cache: "no-store",
        });

        if (response.status === 401) {
          handlers.onUnauthorized();
          return;
        }
        if (!response.ok || !response.body) {
          throw new Error(`the event stream answered ${response.status}`);
        }

        wait = FIRST_RETRY_MS;
        handlers.onStatus("live");
        handlers.onOpen();

        await readFrames(response.body, (name, data) => deliver(handlers, name, data));

        if (stopped) {
          return;
        }
        handlers.onStatus("retrying", "The live feed closed.");
      } catch (error) {
        if (stopped || (error instanceof DOMException && error.name === "AbortError")) {
          return;
        }
        handlers.onStatus("retrying", "The live feed dropped.");
      }

      await new Promise<void>((resolve) => {
        timer = setTimeout(resolve, wait);
      });
      wait = Math.min(wait * 2, MAX_RETRY_MS);
    }
  };

  void run();

  return () => {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
    }
    controller.abort();
  };
}

async function readFrames(
  body: ReadableStream<Uint8Array>,
  onFrame: (name: string, data: string) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      return;
    }

    buffer += decoder.decode(value, { stream: true });

    let split = buffer.indexOf("\n\n");
    while (split !== -1) {
      const frame = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      handleFrame(frame, onFrame);
      split = buffer.indexOf("\n\n");
    }
  }
}

function handleFrame(frame: string, onFrame: (name: string, data: string) => void): void {
  let name = "message";
  const data: string[] = [];

  for (const line of frame.split("\n")) {
    if (line === "" || line.startsWith(":")) {
      continue;
    }
    if (line.startsWith("event:")) {
      name = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      data.push(line.slice(5).replace(/^ /, ""));
    }
  }

  if (data.length > 0) {
    onFrame(name, data.join("\n"));
  }
}

function deliver(handlers: StreamHandlers, name: string, raw: string): void {
  if (name === "ready") {
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }

  const event = parsed as OwnerEvent;
  if (typeof event?.type !== "string") {
    return;
  }

  if (event.type === "ledger") {
    const entry = event.data as LedgerEntry;
    if (entry && typeof entry.seq === "number") {
      handlers.onLedger(entry);
    }
    return;
  }

  if (brainTypes.has(event.type)) {
    handlers.onBrain(event.sessionId, event.data as BrainEvent);
  }
}
