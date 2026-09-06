"use client";

import { useCallback, useEffect, useState } from "react";
import { OlaiError, getWallet, say, type WalletState } from "@/lib/api";
import { usd } from "@/lib/format";

/**
 * The Agentic Wallet, as the CLI reports it.
 *
 * Olai holds no keys. Everything here is read from the wallet itself, so an
 * unconnected wallet says so rather than showing zeros that look like a balance.
 */
export function WalletPanel({
  token,
  onUnauthorized,
  refreshKey,
}: {
  token: string;
  onUnauthorized: () => void;
  refreshKey: number;
}) {
  const [wallet, setWallet] = useState<WalletState | null>(null);
  const [problem, setProblem] = useState<{ message: string; nextStep: string } | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    (signal?: AbortSignal) =>
      getWallet(token, signal)
        .then((state) => {
          setWallet(state);
          setProblem(null);
          setLoading(false);
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") {
            return;
          }
          if (error instanceof OlaiError && error.unauthorized) {
            onUnauthorized();
            return;
          }
          const failure = say(error);
          setProblem({ message: failure.message, nextStep: failure.nextStep });
          setLoading(false);
        }),
    [token, onUnauthorized],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, refreshKey]);

  const settings = wallet?.settings ?? null;
  const spent = settings ? Math.max(0, settings.x402DailyLimit - settings.x402QuotaLeft) : 0;
  const used = settings && settings.x402DailyLimit > 0 ? spent / settings.x402DailyLimit : 0;

  return (
    <section className="desk-panel p-6">
      <header className="flex items-baseline justify-between gap-4">
        <h2 className="desk-heading">Wallet</h2>
        {wallet ? (
          <span
            className={`font-mono text-[0.62rem] uppercase tracking-[0.18em] ${
              wallet.status === "CONNECTED" ? "text-ok" : "text-bad"
            }`}
          >
            {wallet.status === "CONNECTED" ? "Connected" : wallet.status}
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
          <div className="desk-skeleton h-8" />
        </div>
      ) : !wallet || wallet.status !== "CONNECTED" ? (
        <div className="mt-5">
          <p className="text-[0.88rem] leading-[1.5] text-ink/70">
            No wallet is connected, so Olai cannot buy data.
          </p>
          <p className="mt-1 text-[0.82rem] leading-[1.45] text-ink/55">
            Run baw login in a terminal, then reload the desk.
          </p>
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-6">
          {settings ? (
            <div>
              <p className="desk-label">Left to spend on data today</p>
              <p className="desk-figure mt-2">{usd(settings.x402QuotaLeft)}</p>
              <div className="desk-meter mt-3" aria-hidden>
                <span style={{ width: `${Math.min(100, Math.round(used * 100))}%` }} />
              </div>
              <p className="mt-2 font-mono text-[0.68rem] uppercase tracking-[0.14em] text-ink/40">
                {usd(spent)} of {usd(settings.x402DailyLimit)} x402 limit
              </p>
            </div>
          ) : null}

          <div>
            <p className="desk-label">Balances</p>
            {wallet.balances.length === 0 ? (
              <p className="mt-2 text-[0.85rem] text-ink/50">
                Nothing in the wallet yet. Fund it in the Binance app.
              </p>
            ) : (
              <ul className="mt-3 flex flex-col gap-2">
                {wallet.balances.map((balance) => (
                  <li
                    key={`${balance.binanceChainId}-${balance.tokenAddress}`}
                    className="flex items-baseline justify-between gap-3 border-b border-ink/[0.06] pb-2 last:border-0"
                  >
                    <span className="font-mono text-[0.78rem] uppercase tracking-[0.1em] text-ink/60">
                      {balance.tokenSymbol}
                    </span>
                    <span className="text-right">
                      <span className="block font-mono text-[0.85rem] text-ink">{balance.balance}</span>
                      <span className="block font-mono text-[0.68rem] text-ink/40">
                        {usd(Number.parseFloat(balance.balanceUsd))}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
