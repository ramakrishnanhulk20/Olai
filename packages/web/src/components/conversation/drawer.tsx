"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { Health, LedgerEntry, Rulebook } from "@/lib/api";
import { AccountPanel } from "@/components/desk/account-panel";
import { RulebookPanel } from "@/components/desk/rulebook-panel";
import { WalletPanel } from "@/components/desk/wallet-panel";
import { LedgerList } from "./ledger-list";

/**
 * Everything that is not the conversation, one click away.
 *
 * The rulebook, the money and the receipt are what the owner checks now and
 * then, not what they read an answer in, so they live behind one button instead
 * of crowding three columns around the question.
 */

export type DrawerTab = "rulebook" | "wallet" | "ledger";

const WIDE = "(min-width: 768px)";

function watchWidth(listener: () => void): () => void {
  const query = window.matchMedia(WIDE);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

function readNarrow(): boolean {
  return !window.matchMedia(WIDE).matches;
}

export const DRAWER_TABS: Array<{ id: DrawerTab; label: string }> = [
  { id: "rulebook", label: "Rulebook" },
  { id: "wallet", label: "Wallet and account" },
  { id: "ledger", label: "Ledger" },
];

const REPLAY_WALLET =
  "When you are the owner this reads the Agentic Wallet: what is left of today's x402 limit, and every token balance the wallet holds.";
const REPLAY_ACCOUNT =
  "When you are the owner this reads the sub-account: what it is down today, what it has spent on data, and every position it holds.";
const OWNER_ONLY = "Editable when you are the owner";

export function Drawer({
  open,
  tab,
  token,
  replayRulebook,
  health,
  serviceHost,
  entries,
  ledgerLoading,
  ledgerProblem,
  moneyMoved,
  mounted,
  onTab,
  onClose,
  onRetryLedger,
  onUnauthorized,
  onShowWelcome,
}: {
  open: boolean;
  tab: DrawerTab;
  token?: string;
  replayRulebook?: Rulebook;
  health: Health | null;
  serviceHost: string | null;
  entries: LedgerEntry[];
  ledgerLoading: boolean;
  ledgerProblem: { message: string; nextStep: string } | null;
  moneyMoved: number;
  mounted: boolean;
  onTab: (tab: DrawerTab) => void;
  onClose: () => void;
  onRetryLedger?: () => void;
  onUnauthorized?: () => void;
  onShowWelcome: () => void;
}) {
  const shouldReduce = useReducedMotion() ?? false;
  const closeRef = useRef<HTMLButtonElement>(null);
  // A sheet comes up from the bottom of a phone and a drawer comes in from the
  // side of a desk, so the direction is read off the screen rather than guessed.
  const sheet = useSyncExternalStore(watchWidth, readNarrow, () => false);
  const replay = replayRulebook !== undefined;

  useEffect(() => {
    if (open) {
      closeRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const hidden = shouldReduce ? { opacity: 0 } : sheet ? { y: "100%" } : { x: "100%" };
  const here = shouldReduce ? { opacity: 1 } : sheet ? { y: 0 } : { x: 0 };

  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.button
            type="button"
            aria-label="Close the details"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            onClick={onClose}
            className="fixed inset-0 z-[100] cursor-default bg-ground/70 backdrop-blur-[2px]"
          />

          <motion.aside
            initial={hidden}
            animate={here}
            exit={hidden}
            transition={{ duration: shouldReduce ? 0.2 : 0.45, ease: [0.16, 1, 0.3, 1] }}
            className="conv-drawer flex flex-col"
            role="dialog"
            aria-label="Details"
          >
            <div className="flex items-center justify-between gap-4 border-b border-ink/10 px-5 py-3.5">
              <p className="flex items-center gap-2.5 font-mono text-[0.66rem] uppercase tracking-[0.2em] text-amber">
                <span className="block size-2 rounded-[2px] bg-amber" />
                Details
              </p>
              <button
                ref={closeRef}
                type="button"
                onClick={onClose}
                aria-label="Close the details"
                className="flex size-11 items-center justify-center text-ink/60 transition-colors duration-300 hover:text-amber"
              >
                <svg viewBox="0 0 16 16" className="size-4" fill="none" aria-hidden>
                  <path
                    d="M3 3l10 10M13 3L3 13"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>

            <div className="flex border-b border-ink/10 px-2" role="tablist" aria-label="Details">
              {DRAWER_TABS.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === entry.id}
                  onClick={() => onTab(entry.id)}
                  className={`conv-tab ${tab === entry.id ? "is-on" : ""}`}
                >
                  {entry.label}
                </button>
              ))}
            </div>

            <div className="desk-scroll min-h-0 flex-1 p-5" data-lenis-prevent>
              {tab === "rulebook" ? (
                replay ? (
                  <RulebookPanel replay={replayRulebook} note={OWNER_ONLY} />
                ) : (
                  <RulebookPanel token={token} onUnauthorized={onUnauthorized} />
                )
              ) : null}

              {tab === "wallet" ? (
                <div className="flex flex-col gap-5">
                  {replay ? (
                    <>
                      <WalletPanel replay={REPLAY_WALLET} />
                      <AccountPanel replay={REPLAY_ACCOUNT} />
                    </>
                  ) : (
                    <>
                      <WalletPanel
                        token={token}
                        onUnauthorized={onUnauthorized}
                        refreshKey={moneyMoved}
                      />
                      <AccountPanel
                        token={token}
                        onUnauthorized={onUnauthorized}
                        refreshKey={moneyMoved}
                      />
                    </>
                  )}
                </div>
              ) : null}

              {tab === "ledger" ? (
                <LedgerList
                  {...(token ? { token } : {})}
                  entries={entries}
                  loading={ledgerLoading}
                  problem={ledgerProblem}
                  mounted={mounted}
                  {...(replay ? { replay: { lines: entries.length } } : {})}
                  {...(onRetryLedger ? { onRetry: onRetryLedger } : {})}
                  {...(onUnauthorized ? { onUnauthorized } : {})}
                />
              ) : null}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-ink/10 px-5 py-3">
              <p className="font-mono text-[0.62rem] uppercase tracking-[0.16em] text-ink/55">
                {replay || serviceHost === null
                  ? "Recorded run, no service"
                  : `${serviceHost}${health ? ` · build ${health.version}` : ""}`}
              </p>
              <button type="button" onClick={onShowWelcome} className="conv-tap group">
                <span className="border-b border-ink/20 pb-0.5 font-mono text-[0.62rem] uppercase tracking-[0.16em] text-ink/60 transition-colors duration-300 group-hover:border-amber group-hover:text-amber">
                  Show the welcome again
                </span>
              </button>
            </div>
          </motion.aside>
        </>
      ) : null}
    </AnimatePresence>
  );
}
