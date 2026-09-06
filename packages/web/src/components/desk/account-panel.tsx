"use client";

import { useCallback, useEffect, useState } from "react";
import { OlaiError, getAccount, say, type AccountState } from "@/lib/api";
import { ago, usd } from "@/lib/format";

/**
 * Where the account stands, read the way the rulebook reads it.
 *
 * These are the same four numbers the engine checks an order against, so a
 * refusal on the right can always be traced to a number on the left.
 *
 * A replay has no sub-account to read, so it says so instead of showing figures
 * that were never captured.
 */
export function AccountPanel({
  token,
  onUnauthorized,
  refreshKey,
  replay,
}: {
  token?: string;
  onUnauthorized?: () => void;
  refreshKey?: number;
  replay?: string;
}) {
  const [account, setAccount] = useState<AccountState | null>(null);
  const [problem, setProblem] = useState<{ message: string; nextStep: string } | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    (signal?: AbortSignal) =>
      getAccount(token ?? "", signal)
        .then((state) => {
          setAccount(state);
          setProblem(null);
          setLoading(false);
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") {
            return;
          }
          if (error instanceof OlaiError && error.unauthorized) {
            onUnauthorized?.();
            return;
          }
          const failure = say(error);
          setProblem({ message: failure.message, nextStep: failure.nextStep });
          setLoading(false);
        }),
    [token, onUnauthorized],
  );

  useEffect(() => {
    if (replay) {
      return;
    }
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, refreshKey, replay]);

  if (replay) {
    return (
      <section className="desk-panel p-6">
        <header className="flex items-baseline justify-between gap-4">
          <h2 className="desk-heading">Account</h2>
          <span className="font-mono text-[0.62rem] uppercase tracking-[0.16em] text-ink/35">
            Not shown in replay
          </span>
        </header>
        <p className="mt-5 text-[0.88rem] leading-[1.5] text-ink/55">{replay}</p>
        <p className="mt-2 text-[0.82rem] leading-[1.45] text-ink/40">
          Daily loss counts price moves as well as fills.
        </p>
      </section>
    );
  }

  return (
    <section className="desk-panel p-6">
      <header className="flex items-baseline justify-between gap-4">
        <h2 className="desk-heading">Account</h2>
        {account?.lastOrderAtIso ? (
          <span className="font-mono text-[0.62rem] uppercase tracking-[0.16em] text-ink/35">
            Last order {ago(account.lastOrderAtIso)}
          </span>
        ) : null}
      </header>

      {problem ? (
        <div className="mt-5">
          <p className="text-[0.88rem] leading-[1.45] text-bad">{problem.message}</p>
          <p className="mt-1 text-[0.82rem] leading-[1.45] text-ink/55">{problem.nextStep}</p>
          <button type="button" onClick={() => void load()} className="desk-button-quiet mt-4 px-4 py-2 text-[0.82rem]">
            Try again
          </button>
        </div>
      ) : loading ? (
        <div className="mt-6 space-y-3" aria-hidden>
          <div className="desk-skeleton h-12" />
          <div className="desk-skeleton h-12" />
        </div>
      ) : account ? (
        <div className="mt-6 flex flex-col gap-6">
          <div className="grid grid-cols-2 gap-5">
            <div>
              <p className="desk-label">Down today</p>
              <p className={`desk-figure mt-2 ${account.dailyLossUsd > 0 ? "text-bad" : "text-ink"}`}>
                {usd(account.dailyLossUsd)}
              </p>
              <p className="mt-2 text-[0.78rem] leading-[1.4] text-ink/40">
                Daily loss counts price moves as well as fills.
              </p>
            </div>
            <div>
              <p className="desk-label">Spent on data today</p>
              <p className="desk-figure mt-2">{usd(account.dailyDataSpendUsd)}</p>
            </div>
          </div>

          <div>
            <p className="desk-label">
              Open positions
              {account.openPositions.length > 0 ? ` (${account.openPositions.length})` : ""}
            </p>
            {account.openPositions.length === 0 ? (
              <p className="mt-2 text-[0.85rem] text-ink/50">Nothing held.</p>
            ) : (
              <ul className="desk-scroll mt-3 flex max-h-[15rem] flex-col gap-2 pr-2" data-lenis-prevent>
                {account.openPositions.map((position) => (
                  <li
                    key={position.symbol}
                    className="flex items-baseline justify-between gap-3 border-b border-ink/[0.06] pb-2 last:border-0"
                  >
                    <span className="font-mono text-[0.78rem] uppercase tracking-[0.1em] text-ink/60">
                      {position.symbol}
                      <span className="ml-2 text-ink/35">{position.side}</span>
                    </span>
                    <span className="font-mono text-[0.85rem] text-ink">{usd(position.usd)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
