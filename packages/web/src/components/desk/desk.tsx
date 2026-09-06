"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { motion, useReducedMotion, type Variants } from "framer-motion";
import {
  API_BASE,
  OlaiError,
  approveSession,
  ask as askOlai,
  getHealth,
  getLedgerSince,
  getSession,
  kill as killOlai,
  listSessions,
  rejectSession,
  resume as resumeOlai,
  say,
  type Health,
  type LedgerEntry,
  type SessionRecord,
} from "@/lib/api";
import {
  REPLAY_STEP_MS,
  recordedEntries,
  recordedFillSummary,
  recordedLines,
  recordedSession,
  recordedStream,
  replayRulebook,
} from "@/lib/replay";
import { openEventStream, type BrainEvent } from "@/lib/sse";
import { clearToken, noToken, readToken, subscribeToken, writeToken } from "@/lib/token";
import { AccountPanel } from "./account-panel";
import { AskBox } from "./ask-box";
import { Gate } from "./gate";
import { KillSwitch } from "./kill-switch";
import { LedgerTable } from "./ledger-table";
import { ProposalCard } from "./proposal-card";
import { ReplayBanner } from "./replay-banner";
import { SessionPicker, type Arrival } from "./session-picker";
import { RulebookPanel } from "./rulebook-panel";
import { StatusChip } from "./status-chip";
import { ThinkingStream } from "./thinking-stream";
import { WalletPanel } from "./wallet-panel";

const HEALTH_EVERY_MS = 10_000;
const SESSIONS_EVERY_MS = 10_000;

/** Ledger lines that change what the side panels say about money. */
const MOVES_MONEY = new Set([
  "payment.signed",
  "payment.settled",
  "order.filled",
  "order.failed",
  "order.sent",
]);

/** Ledger lines that mean a session record on the service has moved on. */
const MOVES_SESSION = new Set([
  "proposal",
  "rule.refused",
  "approval",
  "rejection",
  "order.sent",
  "order.filled",
  "order.failed",
]);

const OWNER_ONLY = "Editable when you are the owner";

/**
 * Whether this render is the browser's rather than the server's.
 *
 * The recorded lines carry clock times, and a server in one timezone rendering
 * for a browser in another would not agree on how to write them. The panels wait
 * for the browser, so the times are the visitor's own.
 */
const noSubscribe = () => () => undefined;
const inBrowser = () => true;
const onServer = () => false;

type Problem = { message: string; nextStep: string } | null;

/** The service hands the list back oldest first. The owner reads it the other way. */
function byNewest(records: SessionRecord[]): SessionRecord[] {
  return [...records].sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
  );
}

const panel: Variants = {
  hidden: { opacity: 0, y: 26 },
  show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] } },
};

const flat: Variants = { hidden: { opacity: 1, y: 0 }, show: { opacity: 1, y: 0 } };

/**
 * Which desk the visitor gets.
 *
 * A token in this tab means the real desk. No token means the replay of a
 * recorded run, because a gate is a dead end for everyone but the owner. The
 * gate is one click away from the replay, and a refused token brings it back.
 */
export function Desk() {
  // The token lives in sessionStorage, which is an outside system, not React
  // state. Reading it this way also means the server renders the replay.
  const token = useSyncExternalStore(subscribeToken, readToken, noToken);
  const [gateNotice, setGateNotice] = useState<string | null>(null);
  const [gateOpen, setGateOpen] = useState(false);

  const lockOut = useCallback(() => {
    clearToken();
    setGateNotice("That token is not the owner's. Check OLAI_OWNER_TOKEN in .env.");
    setGateOpen(true);
  }, []);

  const takeToken = useCallback((next: string) => {
    setGateNotice(null);
    setGateOpen(false);
    writeToken(next);
  }, []);

  if (token) {
    return <LiveDesk token={token} lockOut={lockOut} />;
  }

  if (gateOpen) {
    return (
      <Gate
        onToken={takeToken}
        notice={gateNotice}
        onBack={() => {
          setGateNotice(null);
          setGateOpen(false);
        }}
      />
    );
  }

  return <ReplayDesk onOpenGate={() => setGateOpen(true)} />;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative isolate min-h-[100svh] bg-ground pb-24">
      <div className="pointer-events-none fixed inset-0 -z-10" aria-hidden>
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(52rem 40rem at 88% -8%, rgba(245,165,36,0.16), rgba(245,165,36,0.03) 46%, rgba(10,10,10,0) 74%)",
          }}
        />
      </div>
      {/* The grain sits half a screen outside its box on every side, so it needs a
          window to be clipped by, or it widens the page on a phone. */}
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden>
        <div className="film-grain opacity-[0.05]" />
      </div>
      {children}
    </main>
  );
}

function Wordmark() {
  return (
    <Link
      href="/"
      className="group flex items-center gap-3 font-display text-[1.05rem] font-medium tracking-[-0.02em] text-ink transition-opacity duration-300 hover:opacity-70"
    >
      <span className="block size-2.5 rounded-[2px] bg-amber transition-transform duration-300 group-hover:rotate-45" />
      Olai
    </Link>
  );
}

/**
 * The recorded run, played back.
 *
 * Nothing on this screen calls the service, so it works with no service running
 * at all, which is what a deployed judge gets. Every figure, hash and summary
 * comes out of the ledger export.
 */
function ReplayDesk({ onOpenGate }: { onOpenGate: () => void }) {
  const shouldReduce = useReducedMotion() ?? false;
  const mounted = useSyncExternalStore(noSubscribe, inBrowser, onServer);
  // The recorded run arrives a line at a time, the way it did when it ran.
  const [played, setPlayed] = useState(1);

  useEffect(() => {
    if (!mounted || shouldReduce) {
      return;
    }
    const timer = setInterval(
      () => setPlayed((count) => Math.min(count + 1, recordedStream.length)),
      REPLAY_STEP_MS,
    );
    return () => clearInterval(timer);
  }, [mounted, shouldReduce]);

  const stream = recordedStream.slice(0, shouldReduce ? recordedStream.length : played);
  const enter = shouldReduce ? flat : panel;

  return (
    <Shell>
      <header className="sticky top-0 z-40 border-b border-ink/10 bg-ground/85 backdrop-blur-md">
        <div className="flex h-16 items-center justify-between gap-4 px-[clamp(1rem,3vw,2.75rem)]">
          <Wordmark />
          <div className="flex items-center gap-4 sm:gap-6">
            <StatusChip health={null} offline={false} replay />
            <KillSwitch
              killed={false}
              busy={false}
              disabled
              note={OWNER_ONLY}
              problem={null}
              onKill={() => undefined}
              onResume={() => undefined}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-ink/[0.06] px-[clamp(1rem,3vw,2.75rem)] py-2 font-mono text-[0.62rem] uppercase tracking-[0.18em] text-ink/30">
          <span>The owner&apos;s desk</span>
          <span>Recorded run</span>
          <span>Kill switch {OWNER_ONLY.toLowerCase()}</span>
        </div>
        <ReplayBanner onOpenGate={onOpenGate} />
      </header>

      {mounted ? (
        <motion.div
          initial="hidden"
          animate="show"
          variants={{
            hidden: {},
            show: { transition: { staggerChildren: shouldReduce ? 0 : 0.08, delayChildren: 0.06 } },
          }}
          className="grid grid-cols-[minmax(0,1fr)] gap-6 px-[clamp(1rem,3vw,2.75rem)] pt-8 lg:grid-cols-12 lg:gap-7 lg:pt-12"
        >
          <div className="order-2 flex flex-col gap-6 lg:order-none lg:col-span-3 lg:pt-14">
            <motion.div variants={enter}>
              <RulebookPanel replay={replayRulebook} note={OWNER_ONLY} />
            </motion.div>
            <motion.div variants={enter}>
              <WalletPanel replay="When you are the owner this reads the Agentic Wallet: what is left of today's x402 limit, and every token balance the wallet holds." />
            </motion.div>
            <motion.div variants={enter}>
              <AccountPanel replay="When you are the owner this reads the sub-account: what it is down today, what it has spent on data, and every position it holds." />
            </motion.div>
          </div>

          <div className="order-1 flex flex-col gap-6 lg:order-none lg:col-span-5">
            <motion.div variants={enter}>
              <AskBox
                running={false}
                disabled
                disabledReason={null}
                placeholder="Ask questions when you are the owner"
                problem={null}
                onAsk={() => undefined}
              />
            </motion.div>

            <motion.div variants={enter}>
              <ThinkingStream events={stream} running={false} live={false} replay />
            </motion.div>

            <motion.div variants={enter}>
              <SessionPicker
                sessions={[recordedSession]}
                currentId={recordedSession.id}
                loading={false}
                arrival={null}
                replay
              />
            </motion.div>

            <ProposalCard
              session={recordedSession}
              dryRun={false}
              replay
              fillSummary={recordedFillSummary}
            />
          </div>

          <div className="order-3 lg:order-none lg:col-span-4 lg:pt-14">
            <motion.div variants={enter} className="lg:sticky lg:top-40">
              <LedgerTable
                entries={recordedEntries}
                loading={false}
                problem={null}
                replay={{ lines: recordedLines }}
              />
            </motion.div>
          </div>
        </motion.div>
      ) : (
        <div className="px-[clamp(1rem,3vw,2.75rem)] pt-8 lg:pt-12" aria-hidden>
          <div className="desk-skeleton h-[24rem] w-full" />
        </div>
      )}
    </Shell>
  );
}

function LiveDesk({ token, lockOut }: { token: string; lockOut: () => void }) {
  const shouldReduce = useReducedMotion() ?? false;

  const [health, setHealth] = useState<Health | null>(null);
  const [serviceDown, setServiceDown] = useState(false);

  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [arrival, setArrival] = useState<Arrival | null>(null);
  const [events, setEvents] = useState<Record<string, BrainEvent[]>>({});
  const [streamLive, setStreamLive] = useState(false);

  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [ledgerLoading, setLedgerLoading] = useState(true);
  const [ledgerProblem, setLedgerProblem] = useState<Problem>(null);

  const [asking, setAsking] = useState(false);
  const [askProblem, setAskProblem] = useState<Problem>(null);
  const [decideBusy, setDecideBusy] = useState<"approve" | "reject" | null>(null);
  const [decideProblem, setDecideProblem] = useState<Problem>(null);
  const [switchBusy, setSwitchBusy] = useState(false);
  const [switchProblem, setSwitchProblem] = useState<string | null>(null);
  const [moneyMoved, setMoneyMoved] = useState(0);

  const lastSeq = useRef(0);
  const askingRef = useRef(false);
  const currentRef = useRef<string | null>(null);
  // Ids the desk has already seen, and ids it has already gone to fetch. Without
  // the second set, a burst of stream lines about one new session would fire a
  // burst of identical list calls.
  const knownIds = useRef<Set<string>>(new Set());
  const chasing = useRef<Set<string>>(new Set());

  useEffect(() => {
    askingRef.current = asking;
  }, [asking]);

  useEffect(() => {
    currentRef.current = currentId;
  }, [currentId]);

  const pollHealth = useCallback(
    (signal?: AbortSignal) =>
      getHealth(signal)
        .then((state) => {
          setHealth(state);
          setServiceDown(false);
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") {
            return;
          }
          setServiceDown(true);
        }),
    [],
  );

  useEffect(() => {
    const controller = new AbortController();
    void pollHealth(controller.signal);
    const timer = setInterval(() => void pollHealth(controller.signal), HEALTH_EVERY_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [pollHealth]);

  const mergeEntries = useCallback((incoming: LedgerEntry[]) => {
    if (incoming.length === 0) {
      return;
    }
    setLedger((current) => {
      const seen = new Set(current.map((entry) => entry.seq));
      const added = incoming.filter((entry) => !seen.has(entry.seq));
      if (added.length === 0) {
        return current;
      }
      for (const entry of added) {
        lastSeq.current = Math.max(lastSeq.current, entry.seq);
      }
      return [...current, ...added];
    });
  }, []);

  const loadLedger = useCallback(
    (signal?: AbortSignal) =>
      getLedgerSince(token, undefined, signal)
        .then((entries) => {
          lastSeq.current = entries.reduce((top, entry) => Math.max(top, entry.seq), 0);
          setLedger(entries);
          setLedgerProblem(null);
          setLedgerLoading(false);
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") {
            return;
          }
          if (error instanceof OlaiError && error.unauthorized) {
            lockOut();
            return;
          }
          const failure = say(error);
          setLedgerProblem({ message: failure.message, nextStep: failure.nextStep });
          setLedgerLoading(false);
        }),
    [token, lockOut],
  );

  const select = useCallback((id: string) => {
    currentRef.current = id;
    setCurrentId(id);
    setArrival(null);
    setDecideProblem(null);
  }, []);

  const absorbOne = useCallback((record: SessionRecord) => {
    knownIds.current.add(record.id);
    chasing.current.delete(record.id);
    setSessions((current) =>
      byNewest([...current.filter((entry) => entry.id !== record.id), record]),
    );
  }, []);

  /**
   * Takes the whole session list and decides what the owner should be looking at.
   *
   * A session that showed up while the owner was reading a finished one is the
   * reason this list is polled at all: an approval aimed at the old session is
   * an approval that never reaches the new one.
   */
  const absorb = useCallback(
    (records: SessionRecord[]) => {
      const fresh = byNewest(records.filter((record) => !knownIds.current.has(record.id)));
      for (const record of records) {
        knownIds.current.add(record.id);
        chasing.current.delete(record.id);
      }

      const ordered = byNewest(records);
      setSessions(ordered);
      setSessionsLoading(false);

      const picked = ordered.find((record) => record.id === currentRef.current);
      if (!picked) {
        const newest = ordered[0];
        if (newest) {
          select(newest.id);
        }
        return;
      }

      const arrived = fresh.find((record) => record.status === "pending") ?? fresh[0];
      if (!arrived || arrived.id === picked.id) {
        return;
      }
      if (askingRef.current) {
        select(arrived.id);
        return;
      }
      if (picked.status === "pending") {
        setArrival({ id: arrived.id, switched: false });
        return;
      }
      select(arrived.id);
      setArrival({ id: arrived.id, switched: true });
    },
    [select],
  );

  const loadSessions = useCallback(
    (signal?: AbortSignal) =>
      listSessions(token, signal)
        .then(absorb)
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") {
            return;
          }
          if (error instanceof OlaiError && error.unauthorized) {
            lockOut();
            return;
          }
          setSessionsLoading(false);
        }),
    [token, lockOut, absorb],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadLedger(controller.signal);
    void loadSessions(controller.signal);
    const timer = setInterval(() => void loadSessions(controller.signal), SESSIONS_EVERY_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [loadLedger, loadSessions]);

  const refreshSession = useCallback(
    (id: string) =>
      getSession(token, id)
        .then(absorbOne)
        .catch((error: unknown) => {
          if (error instanceof OlaiError && error.unauthorized) {
            lockOut();
          }
        }),
    [token, lockOut, absorbOne],
  );

  /** A stream line about a session the desk has never heard of means read the list now. */
  const chase = useCallback(
    (sessionId: string | undefined) => {
      if (!sessionId || knownIds.current.has(sessionId) || chasing.current.has(sessionId)) {
        return;
      }
      chasing.current.add(sessionId);
      void loadSessions();
    },
    [loadSessions],
  );

  useEffect(() => {
    const close = openEventStream(token, {
      onStatus: (status) => setStreamLive(status === "live"),
      onOpen: () => {
        // A stream that has just come up may have missed lines. The ledger is
        // the record, so the gap is filled from it rather than guessed at.
        void getLedgerSince(token, lastSeq.current || undefined)
          .then(mergeEntries)
          .catch(() => setStreamLive(false));
      },
      onUnauthorized: lockOut,
      onBrain: (sessionId, event) => {
        if (!sessionId) {
          return;
        }
        chase(sessionId);
        setEvents((current) => ({ ...current, [sessionId]: [...(current[sessionId] ?? []), event] }));
        if (askingRef.current && currentRef.current !== sessionId) {
          setCurrentId(sessionId);
        }
      },
      onLedger: (entry) => {
        mergeEntries([entry]);
        chase(entry.sessionId);
        if (MOVES_MONEY.has(entry.kind)) {
          setMoneyMoved((count) => count + 1);
        }
        if (entry.kind === "kill" || entry.kind === "resume") {
          void pollHealth();
        }
        if (entry.sessionId && askingRef.current && currentRef.current !== entry.sessionId) {
          setCurrentId(entry.sessionId);
        }
        if (entry.sessionId && MOVES_SESSION.has(entry.kind)) {
          void refreshSession(entry.sessionId);
        }
      },
    });

    return close;
  }, [token, lockOut, chase, mergeEntries, pollHealth, refreshSession]);

  const onAsk = async (question: string) => {
    setAsking(true);
    setAskProblem(null);
    setDecideProblem(null);
    try {
      const record = await askOlai(token, question);
      absorbOne(record);
      select(record.id);
    } catch (error) {
      if (error instanceof OlaiError && error.unauthorized) {
        lockOut();
        return;
      }
      const failure = say(error);
      setAskProblem({ message: failure.message, nextStep: failure.nextStep });
    } finally {
      setAsking(false);
    }
  };

  const decide = async (action: "approve" | "reject", reason?: string) => {
    if (!currentId) {
      return;
    }
    setDecideBusy(action);
    setDecideProblem(null);
    try {
      const record =
        action === "approve"
          ? await approveSession(token, currentId)
          : await rejectSession(token, currentId, reason ?? "The owner gave no reason.");
      absorbOne(record);
    } catch (error) {
      if (error instanceof OlaiError && error.unauthorized) {
        lockOut();
        return;
      }
      if (error instanceof OlaiError && error.status === 404) {
        // Sessions live in the service's memory, so a restart takes them with it.
        setDecideProblem({
          message: "This session is gone.",
          nextStep: "The service was restarted. Ask the question again.",
        });
        knownIds.current.delete(currentId);
        void loadSessions();
        return;
      }
      const failure = say(error);
      setDecideProblem({ message: failure.message, nextStep: failure.nextStep });
    } finally {
      setDecideBusy(null);
    }
  };

  const flip = async (stop: boolean) => {
    setSwitchBusy(true);
    setSwitchProblem(null);
    try {
      if (stop) {
        await killOlai(token);
      } else {
        await resumeOlai(token);
      }
      await pollHealth();
    } catch (error) {
      if (error instanceof OlaiError && error.unauthorized) {
        lockOut();
        return;
      }
      setSwitchProblem(say(error).message);
    } finally {
      setSwitchBusy(false);
    }
  };

  const current = sessions.find((entry) => entry.id === currentId) ?? null;
  const stream = currentId ? (events[currentId] ?? []) : [];
  const killed = health?.killed ?? false;
  const enter = shouldReduce ? flat : panel;

  return (
    <Shell>
      <header className="sticky top-0 z-40 border-b border-ink/10 bg-ground/85 backdrop-blur-md">
        <div className="flex h-16 items-center justify-between gap-4 px-[clamp(1rem,3vw,2.75rem)]">
          <Wordmark />

          <div className="flex items-center gap-4 sm:gap-6">
            <StatusChip health={health} offline={serviceDown} />
            <KillSwitch
              killed={killed}
              busy={switchBusy}
              disabled={serviceDown}
              problem={switchProblem}
              onKill={() => void flip(true)}
              onResume={() => void flip(false)}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-ink/[0.06] px-[clamp(1rem,3vw,2.75rem)] py-2 font-mono text-[0.62rem] uppercase tracking-[0.18em] text-ink/30">
          <span>The owner&apos;s desk</span>
          <span>{new URL(API_BASE).host}</span>
          {health ? <span>Build {health.version}</span> : null}
          <span className={streamLive ? "text-ok/70" : "text-ink/30"}>
            {streamLive ? "Feed live" : "Feed off"}
          </span>
        </div>
      </header>

      {serviceDown ? (
        <p className="border-b border-bad/30 bg-bad/[0.06] px-[clamp(1rem,3vw,2.75rem)] py-3 text-[0.88rem] text-bad">
          The service is not answering at {new URL(API_BASE).host}. Start it with npm run dev -w
          @olai/agent, and check that OLAI_WEB_ORIGIN in its .env matches this page&apos;s origin.
        </p>
      ) : null}

      <motion.div
        initial="hidden"
        animate="show"
        variants={{
          hidden: {},
          show: { transition: { staggerChildren: shouldReduce ? 0 : 0.08, delayChildren: 0.06 } },
        }}
        className="grid grid-cols-[minmax(0,1fr)] gap-6 px-[clamp(1rem,3vw,2.75rem)] pt-8 lg:grid-cols-12 lg:gap-7 lg:pt-12"
      >
        <div className="order-2 flex flex-col gap-6 lg:order-none lg:col-span-3 lg:pt-14">
          <motion.div variants={enter}>
            <RulebookPanel token={token} onUnauthorized={lockOut} />
          </motion.div>
          <motion.div variants={enter}>
            <WalletPanel token={token} onUnauthorized={lockOut} refreshKey={moneyMoved} />
          </motion.div>
          <motion.div variants={enter}>
            <AccountPanel token={token} onUnauthorized={lockOut} refreshKey={moneyMoved} />
          </motion.div>
        </div>

        <div className="order-1 flex flex-col gap-6 lg:order-none lg:col-span-5">
          <motion.div variants={enter}>
            <AskBox
              running={asking}
              disabled={serviceDown || killed}
              disabledReason={
                killed ? "Olai is stopped. Resume it above before asking anything." : null
              }
              problem={askProblem}
              onAsk={(question) => void onAsk(question)}
            />
          </motion.div>

          <motion.div variants={enter}>
            <ThinkingStream events={stream} running={asking} live={streamLive} />
          </motion.div>

          <motion.div variants={enter}>
            <SessionPicker
              sessions={sessions}
              currentId={currentId}
              loading={sessionsLoading}
              arrival={arrival}
              onPick={select}
              onDismiss={() => setArrival(null)}
            />
          </motion.div>

          {current ? (
            <ProposalCard
              session={current}
              dryRun={health?.dryRun ?? false}
              busy={decideBusy}
              problem={decideProblem}
              onApprove={() => void decide("approve")}
              onReject={(reason) => void decide("reject", reason)}
            />
          ) : null}
        </div>

        <div className="order-3 lg:order-none lg:col-span-4 lg:pt-14">
          <motion.div variants={enter} className="lg:sticky lg:top-28">
            <LedgerTable
              token={token}
              entries={ledger}
              loading={ledgerLoading}
              problem={ledgerProblem}
              onRetry={() => {
                setLedgerLoading(true);
                void loadLedger();
              }}
              onUnauthorized={lockOut}
            />
          </motion.div>
        </div>
      </motion.div>
    </Shell>
  );
}
