"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  API_BASE,
  OlaiError,
  approveSession,
  ask as askOlai,
  getHealth,
  getLedgerSince,
  getRulebook,
  getSession,
  kill as killOlai,
  listSessions,
  rejectSession,
  resume as resumeOlai,
  say,
  type Health,
  type LedgerEntry,
  type Rulebook,
  type SessionRecord,
} from "@/lib/api";
import {
  REPLAY_STEP_MS,
  recordedFillSentence,
  recordedSession,
  recordedSessionEntries,
  recordedStream,
  replayRulebook,
} from "@/lib/replay";
import { openEventStream, type BrainEvent } from "@/lib/sse";
import { clearToken, noToken, readToken, subscribeToken, writeToken } from "@/lib/token";
import { Gate } from "@/components/desk/gate";
import { ReplayBanner } from "@/components/desk/replay-banner";
import { Composer } from "./composer";
import { Drawer, type DrawerTab } from "./drawer";
import { closedOnServer, readDrawer, subscribeDrawer, writeDrawer } from "./drawer-state";
import { Header } from "./header";
import { SessionDropdown, SessionRail } from "./session-rail";
import { Thread } from "./thread";
import { Welcome } from "./welcome";

/**
 * The desk as one conversation with your analyst.
 *
 * A visitor with the owner's token gets the live service. Everyone else gets the
 * recorded run, because a gate is a dead end for anyone who cannot open it. The
 * two share one screen, so what a judge reads is the screen the owner uses.
 */

const HEALTH_EVERY_MS = 10_000;
const SESSIONS_EVERY_MS = 10_000;

/** Ledger lines that change what the wallet and account panels say about money. */
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

/**
 * Payment lines the ledger writes without a session id: the wallet code that
 * signs and settles knows the merchant, not the question that sent it there.
 */
const UNTAGGED_MONEY = new Set(["payment.signed", "payment.settled", "data.received"]);

const NOT_YOURS = "Stopping Olai is the owner's to do.";

type Problem = { message: string; nextStep: string } | null;

const noSubscribe = () => () => undefined;
const inBrowser = () => true;
const onServer = () => false;

/** The service hands the list back oldest first. The owner reads it the other way. */
function byNewest(records: SessionRecord[]): SessionRecord[] {
  return [...records].sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
  );
}

/**
 * One session's lines, in the order they were written.
 *
 * A payment line carries no session id, so it is read as belonging to whichever
 * session wrote the last line before it. Payments are made one at a time and the
 * session writes its own priced line immediately before signing, so the line
 * above a payment is the question that paid for it.
 *
 * Adoption stops for good once a later question has been asked. Two sessions
 * can write into the ledger at the same time, and an older thread that writes
 * one more line after the new one started would otherwise pick up the payments
 * the new one is making. A payment shown twice is worse than a payment shown
 * once in the receipt only, where it always is.
 */
function threadEntries(all: LedgerEntry[], sessionId: string): LedgerEntry[] {
  const sorted = [...all].sort((a, b) => a.seq - b.seq);
  const out: LedgerEntry[] = [];
  let started = false;
  let ours = false;
  let newerSession = false;

  for (const entry of sorted) {
    if (entry.sessionId !== undefined) {
      ours = entry.sessionId === sessionId;
      if (ours) {
        started = true;
        out.push(entry);
      } else if (started) {
        newerSession = true;
      }
      continue;
    }
    if (ours && !newerSession && UNTAGGED_MONEY.has(entry.kind)) {
      out.push(entry);
    }
  }

  return out;
}

export function Conversation() {
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
    return <LiveConversation token={token} lockOut={lockOut} />;
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

  return <ReplayConversation onOpenGate={() => setGateOpen(true)} />;
}

interface ScreenProps {
  replay: boolean;
  token?: string;
  health: Health | null;
  serviceDown: boolean;
  killed: boolean;
  switchBusy: boolean;
  switchDisabled: boolean;
  switchNote?: string | null;
  switchProblem: string | null;
  sessions: SessionRecord[];
  sessionsLoading: boolean;
  currentId: string | null;
  entries: LedgerEntry[];
  ledgerLoading: boolean;
  ledgerProblem: Problem;
  events: BrainEvent[];
  rulebook: Rulebook | null;
  fillSentence?: string;
  asking: boolean;
  askProblem: Problem;
  composerDisabled: boolean;
  composerReason: string | null;
  decideBusy: "approve" | "reject" | null;
  decideProblem: Problem;
  moneyMoved: number;
  onPick: (id: string) => void;
  onAsk: (question: string) => void;
  onApprove?: () => void;
  onReject?: (reason: string) => void;
  onKill: () => void;
  onResume: () => void;
  onRetryLedger?: () => void;
  onUnauthorized?: () => void;
  onOpenGate?: () => void;
}

function Screen(props: ScreenProps) {
  const shouldReduce = useReducedMotion() ?? false;
  const mounted = useSyncExternalStore(noSubscribe, inBrowser, onServer);

  // The drawer's own state is in storage, so the owner who works with the receipt
  // open finds it open next time.
  const saved = useSyncExternalStore(subscribeDrawer, readDrawer, closedOnServer);
  const [lastTab, setLastTab] = useState<DrawerTab>("rulebook");
  const [forceWelcome, setForceWelcome] = useState(false);
  const [question, setQuestion] = useState("");

  const drawerOpen = saved !== "closed";
  const tab: DrawerTab = saved === "closed" ? lastTab : saved;

  const openDrawer = useCallback((which: DrawerTab) => {
    setLastTab(which);
    writeDrawer(which);
  }, []);

  const closeDrawer = useCallback(() => {
    setLastTab(tab);
    writeDrawer("closed");
  }, [tab]);

  const current = props.sessions.find((entry) => entry.id === props.currentId) ?? null;
  const thread = useMemo(
    () => (current ? threadEntries(props.entries, current.id) : []),
    [props.entries, current],
  );
  const showWelcome = props.replay || forceWelcome || props.sessions.length === 0;

  return (
    <main className="relative isolate min-h-[100svh] bg-ground">
      <h1 className="sr-only">Olai, the owner&apos;s analyst</h1>

      <div className="pointer-events-none fixed inset-0 -z-10" aria-hidden>
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(56rem 42rem at 84% -10%, rgba(245,165,36,0.16), rgba(245,165,36,0.03) 46%, rgba(10,10,10,0) 74%)",
          }}
        />
      </div>
      {/* The grain sits half a screen outside its box on every side, so it needs a
          window to be clipped by, or it widens the page on a phone. */}
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden>
        <div className="film-grain opacity-[0.05]" />
      </div>

      <Header
        health={props.health}
        offline={props.serviceDown}
        replay={props.replay}
        killed={props.killed}
        switchBusy={props.switchBusy}
        switchDisabled={props.switchDisabled}
        switchNote={props.switchNote ?? null}
        switchProblem={props.switchProblem}
        drawerOpen={drawerOpen}
        onDrawer={() => (drawerOpen ? closeDrawer() : openDrawer(tab))}
        onKill={props.onKill}
        onResume={props.onResume}
      />

      {props.replay && props.onOpenGate ? <ReplayBanner onOpenGate={props.onOpenGate} /> : null}

      {props.serviceDown ? (
        <p
          role="alert"
          className="border-b border-bad/30 bg-bad/[0.06] px-[clamp(1rem,3vw,2.25rem)] py-3 text-[0.88rem] leading-[1.5] text-bad"
        >
          The service is not answering at {new URL(API_BASE).host}. Start it with npm run dev -w
          @olai/agent, and check that OLAI_WEB_ORIGIN in its .env matches this page&apos;s origin.
        </p>
      ) : null}

      <div className="conv-shell">
        <SessionRail
          sessions={props.sessions}
          currentId={props.currentId}
          loading={props.sessionsLoading}
          mounted={mounted}
          onPick={props.onPick}
        />

        <div className="conv-main">
          <div className="conv-column flex min-h-[calc(100svh-4rem)] flex-col gap-8 pt-7">
            <SessionDropdown
              sessions={props.sessions}
              currentId={props.currentId}
              mounted={mounted}
              onPick={props.onPick}
            />

            {showWelcome ? (
              <Welcome
                rulebook={props.rulebook}
                replay={props.replay}
                onEditRulebook={() => openDrawer("rulebook")}
                onExample={(example) => setQuestion(example)}
              />
            ) : null}

            {current ? (
              <Thread
                session={current}
                entries={thread}
                events={props.events}
                running={props.asking && props.sessions[0]?.id === current.id}
                replay={props.replay}
                {...(props.fillSentence === undefined ? {} : { fillSentence: props.fillSentence })}
                busy={props.decideBusy}
                problem={props.decideProblem}
                mounted={mounted}
                {...(props.onApprove ? { onApprove: props.onApprove } : {})}
                {...(props.onReject ? { onReject: props.onReject } : {})}
              />
            ) : null}

            <motion.div
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: shouldReduce ? 0 : 0.6,
                delay: shouldReduce ? 0 : 0.15,
                ease: [0.16, 1, 0.3, 1],
              }}
              className="mt-auto pt-6"
            >
              <Composer
                value={question}
                running={props.asking}
                disabled={props.composerDisabled}
                disabledReason={props.composerReason}
                problem={props.askProblem}
                onChange={setQuestion}
                onAsk={(asked) => {
                  props.onAsk(asked);
                  setQuestion("");
                }}
              />
            </motion.div>
          </div>
        </div>
      </div>

      <Drawer
        open={drawerOpen}
        tab={tab}
        {...(props.token ? { token: props.token } : {})}
        {...(props.replay ? { replayRulebook } : {})}
        health={props.health}
        serviceHost={props.replay ? null : new URL(API_BASE).host}
        entries={props.entries}
        ledgerLoading={props.ledgerLoading}
        ledgerProblem={props.ledgerProblem}
        moneyMoved={props.moneyMoved}
        mounted={mounted}
        onTab={(which) => openDrawer(which)}
        onClose={closeDrawer}
        {...(props.onRetryLedger ? { onRetryLedger: props.onRetryLedger } : {})}
        {...(props.onUnauthorized ? { onUnauthorized: props.onUnauthorized } : {})}
        onShowWelcome={() => {
          setForceWelcome(true);
          closeDrawer();
        }}
      />
    </main>
  );
}

/**
 * The recorded run, played back a line at a time.
 *
 * Nothing here calls the service, so it works with no service running at all,
 * which is what a deployed judge gets. Every figure, hash and sentence comes out
 * of the ledger export.
 */
function ReplayConversation({ onOpenGate }: { onOpenGate: () => void }) {
  const shouldReduce = useReducedMotion() ?? false;
  const mounted = useSyncExternalStore(noSubscribe, inBrowser, onServer);
  const [played, setPlayed] = useState(1);

  useEffect(() => {
    if (!mounted || shouldReduce) {
      return;
    }
    const timer = setInterval(
      () => setPlayed((count) => Math.min(count + 1, recordedSessionEntries.length)),
      REPLAY_STEP_MS,
    );
    return () => clearInterval(timer);
  }, [mounted, shouldReduce]);

  const seen = mounted
    ? recordedSessionEntries.slice(0, shouldReduce ? recordedSessionEntries.length : played)
    : [];
  const events = recordedStream.slice(0, seen.length);

  const has = (kind: string) => seen.some((entry) => entry.kind === kind);
  const base: SessionRecord = {
    id: recordedSession.id,
    question: recordedSession.question,
    createdAt: recordedSession.createdAt,
    status: "pending",
  };
  const session: SessionRecord = !has("proposal")
    ? base
    : has("order.filled")
      ? recordedSession
      : {
          ...base,
          ...(recordedSession.proposal ? { proposal: recordedSession.proposal } : {}),
          ...(recordedSession.verdict ? { verdict: recordedSession.verdict } : {}),
          status: has("approval") ? "approved" : "pending",
        };

  return (
    <Screen
      replay
      health={null}
      serviceDown={false}
      killed={false}
      switchBusy={false}
      switchDisabled
      switchNote={NOT_YOURS}
      switchProblem={null}
      sessions={[session]}
      sessionsLoading={false}
      currentId={session.id}
      entries={seen}
      ledgerLoading={false}
      ledgerProblem={null}
      events={events}
      rulebook={replayRulebook}
      {...(has("order.filled") ? { fillSentence: recordedFillSentence } : {})}
      asking={false}
      askProblem={null}
      composerDisabled
      composerReason="Ask questions when you are the owner."
      decideBusy={null}
      decideProblem={null}
      moneyMoved={0}
      onPick={() => undefined}
      onAsk={() => undefined}
      onKill={() => undefined}
      onResume={() => undefined}
      onOpenGate={onOpenGate}
    />
  );
}

function LiveConversation({ token, lockOut }: { token: string; lockOut: () => void }) {
  const [health, setHealth] = useState<Health | null>(null);
  const [serviceDown, setServiceDown] = useState(false);
  const [rulebook, setRulebook] = useState<Rulebook | null>(null);

  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [events, setEvents] = useState<Record<string, BrainEvent[]>>({});

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

  // The welcome card says what the rules are in one line, so it reads the same
  // rulebook the drawer edits rather than a copy of the shipped defaults.
  useEffect(() => {
    const controller = new AbortController();
    getRulebook(token, controller.signal)
      .then(setRulebook)
      .catch((error: unknown) => {
        if (error instanceof OlaiError && error.unauthorized) {
          lockOut();
        }
      });
    return () => controller.abort();
  }, [token, lockOut]);

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
      if (askingRef.current || picked.status !== "pending") {
        select(arrived.id);
      }
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
      onStatus: () => undefined,
      onOpen: () => {
        // A stream that has just come up may have missed lines. The ledger is
        // the record, so the gap is filled from it rather than guessed at.
        void getLedgerSince(token, lastSeq.current || undefined)
          .then(mergeEntries)
          .catch(() => undefined);
      },
      onUnauthorized: lockOut,
      onBrain: (sessionId, event) => {
        if (!sessionId) {
          return;
        }
        chase(sessionId);
        setEvents((current) => ({
          ...current,
          [sessionId]: [...(current[sessionId] ?? []), event],
        }));
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

  const killed = health?.killed ?? false;

  return (
    <Screen
      replay={false}
      token={token}
      health={health}
      serviceDown={serviceDown}
      killed={killed}
      switchBusy={switchBusy}
      switchDisabled={serviceDown}
      switchProblem={switchProblem}
      sessions={sessions}
      sessionsLoading={sessionsLoading}
      currentId={currentId}
      entries={ledger}
      ledgerLoading={ledgerLoading}
      ledgerProblem={ledgerProblem}
      events={currentId ? (events[currentId] ?? []) : []}
      rulebook={rulebook}
      asking={asking}
      askProblem={askProblem}
      composerDisabled={serviceDown || killed}
      composerReason={
        killed
          ? "Olai is stopped. Resume it at the top of the screen before asking anything."
          : serviceDown
            ? "The service is not answering, so there is nothing to ask."
            : null
      }
      decideBusy={decideBusy}
      decideProblem={decideProblem}
      moneyMoved={moneyMoved}
      onPick={select}
      onAsk={(question) => void onAsk(question)}
      onApprove={() => void decide("approve")}
      onReject={(reason) => void decide("reject", reason)}
      onKill={() => void flip(true)}
      onResume={() => void flip(false)}
      onRetryLedger={() => {
        setLedgerLoading(true);
        void loadLedger();
      }}
      onUnauthorized={lockOut}
    />
  );
}
