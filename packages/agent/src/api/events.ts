/**
 * The live feed the dashboard watches.
 *
 * The agent writes its durable record to the ledger. This is the other half:
 * the running commentary, so the owner can watch Olai think instead of staring
 * at a spinner. Nothing here is durable and nothing here is authoritative. A
 * browser that misses an event reads the ledger to catch up.
 */

export interface OwnerEvent {
  type: string;
  sessionId?: string;
  at: string;
  data: unknown;
}

type Listener = (event: OwnerEvent) => void;

export class EventHub {
  private readonly listeners = new Set<Listener>();

  /**
   * Hands the event to every open stream.
   *
   * One browser that has gone away must not stop the others, so a listener that
   * throws is dropped rather than allowed to break the loop. The set is copied
   * first because a listener may unsubscribe itself while it runs.
   */
  publish(event: OwnerEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch {
        this.listeners.delete(listener);
      }
    }
  }

  /** Starts a stream. Call the returned function to stop it. */
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /** How many streams are open. The API uses it to cap connections. */
  get openStreams(): number {
    return this.listeners.size;
  }
}
