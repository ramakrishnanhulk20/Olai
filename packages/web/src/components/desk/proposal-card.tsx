"use client";

import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { ProposalStatus, SessionRecord } from "@/lib/api";
import { bscscan, host, percent, qty, shortHash, usd } from "@/lib/format";

/**
 * One proposal, and the two buttons that decide it.
 *
 * The rulebook verdict sits under the proposal on purpose: the owner should see
 * what the rules already said before deciding anything, including which rule id
 * said it.
 */

const STATUS: Record<ProposalStatus, { label: string; tone: string; dot: string }> = {
  pending: { label: "Waiting for you", tone: "text-warn", dot: "bg-warn" },
  approved: { label: "Approved", tone: "text-ok", dot: "bg-ok" },
  executed: { label: "Executed", tone: "text-ok", dot: "bg-ok" },
  refused: { label: "Refused by the rulebook", tone: "text-bad", dot: "bg-bad" },
  rejected: { label: "You said no", tone: "text-ink/50", dot: "bg-ink/40" },
  failed: { label: "It did not go through", tone: "text-bad", dot: "bg-bad" },
};

export function ProposalCard({
  session,
  dryRun,
  busy,
  problem,
  onApprove,
  onReject,
}: {
  session: SessionRecord;
  dryRun: boolean;
  busy: "approve" | "reject" | null;
  problem: { message: string; nextStep: string } | null;
  onApprove: () => void;
  onReject: (reason: string) => void;
}) {
  const shouldReduce = useReducedMotion() ?? false;
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  const proposal = session.proposal;
  const status = STATUS[session.status];
  const decidable = session.status === "pending" && proposal?.action.type === "order";

  return (
    <motion.section
      layout={!shouldReduce}
      initial={shouldReduce ? { opacity: 1 } : { opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className="desk-panel p-6 sm:p-8"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="desk-heading">Proposal</h2>
        <span className={`inline-flex items-center gap-2 font-mono text-[0.66rem] uppercase tracking-[0.18em] ${status.tone}`}>
          <span className={`block size-1.5 rounded-[2px] ${status.dot}`} />
          {status.label}
        </span>
      </header>

      <p className="mt-4 text-[0.85rem] leading-[1.5] text-ink/45">{session.question}</p>

      {!proposal ? (
        <p className="mt-6 text-[0.9rem] text-ink/55">Olai has not finished this one yet.</p>
      ) : (
        <>
          <p className="mt-5 max-w-[62ch] text-[1.05rem] leading-[1.55] text-ink/85">
            {proposal.summary}
          </p>

          <p
            className="mt-6 font-display font-extrabold text-ink"
            style={{ fontSize: "clamp(1.5rem, 3.4vw, 2.6rem)", letterSpacing: "-0.035em", lineHeight: 1 }}
          >
            {proposal.action.type === "order"
              ? `${proposal.action.side} ${proposal.action.symbol} for ${usd(proposal.action.quoteUsd)}`
              : "HOLD"}
          </p>
          {proposal.action.type === "order" ? (
            <p className="mt-2 font-mono text-[0.72rem] uppercase tracking-[0.16em] text-ink/40">
              {proposal.action.orderType}
              {proposal.action.limitPrice === undefined
                ? ""
                : ` at ${usd(proposal.action.limitPrice)}`}
            </p>
          ) : (
            <p className="mt-2 max-w-[60ch] text-[0.92rem] leading-[1.5] text-ink/60">
              {proposal.action.reason}
            </p>
          )}

          <div className="mt-6">
            <div className="flex items-baseline justify-between">
              <span className="desk-label">Confidence</span>
              <span className="font-mono text-[0.72rem] text-ink/50">{percent(proposal.confidence)}</span>
            </div>
            <div className="desk-meter mt-2" aria-hidden>
              <motion.span
                initial={shouldReduce ? false : { width: 0 }}
                animate={{ width: percent(proposal.confidence) }}
                transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
              />
            </div>
          </div>

          {proposal.reasoning ? (
            <p className="mt-6 max-w-[64ch] text-[0.92rem] leading-[1.6] text-ink/60">
              {proposal.reasoning}
            </p>
          ) : null}

          <div className="mt-7 grid gap-6 sm:grid-cols-2">
            <div>
              <p className="desk-label">Data it paid for</p>
              {proposal.dataUsed.length === 0 ? (
                <p className="mt-2 text-[0.85rem] text-ink/45">Nothing bought for this one.</p>
              ) : (
                <ul className="mt-3 flex flex-col gap-2">
                  {proposal.dataUsed.map((item) => (
                    <li key={item.url} className="border-b border-ink/[0.06] pb-2 last:border-0">
                      <span className="block break-words font-mono text-[0.78rem] text-ink/70">
                        {host(item.url)}
                      </span>
                      <span className="mt-1 flex items-center gap-3">
                        <span className="font-mono text-[0.72rem] text-amber">{usd(item.costUsd)}</span>
                        {item.txHash ? (
                          <a
                            href={bscscan(item.txHash)}
                            target="_blank"
                            rel="noreferrer"
                            className="font-mono text-[0.72rem] text-ink/40 underline decoration-ink/20 underline-offset-4 transition-colors duration-200 hover:text-ok hover:decoration-ok"
                          >
                            {shortHash(item.txHash)}
                          </a>
                        ) : (
                          <span className="font-mono text-[0.72rem] text-ink/30">no tx</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <p className="desk-label">What could go wrong</p>
              {proposal.risks.length === 0 ? (
                <p className="mt-2 text-[0.85rem] text-ink/45">Olai named no risks.</p>
              ) : (
                <ul className="mt-3 flex flex-col gap-2">
                  {proposal.risks.map((risk) => (
                    <li key={risk} className="flex gap-2.5 text-[0.88rem] leading-[1.5] text-ink/65">
                      <span className="mt-[0.5rem] block size-1.5 shrink-0 rounded-[2px] bg-ink/25" />
                      {risk}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}

      {session.verdict ? (
        <div
          className={`mt-7 rounded-control border p-5 ${
            session.verdict.allowed ? "border-ok/25 bg-ok/[0.04]" : "border-bad/30 bg-bad/[0.05]"
          }`}
        >
          <p
            className={`font-mono text-[0.66rem] uppercase tracking-[0.18em] ${
              session.verdict.allowed ? "text-ok" : "text-bad"
            }`}
          >
            {session.verdict.allowed ? "The rulebook allows this" : "The rulebook refuses this"}
          </p>
          <p className="mt-2 font-mono text-[0.72rem] text-ink/45">
            Biggest order the rules allow right now {usd(session.verdict.effectiveMaxOrderUsd)}
            {session.verdict.requiresApproval ? " · your approval required" : ""}
          </p>
          <ul className="mt-3 flex flex-col gap-2">
            {session.verdict.reasons.map((line, index) => (
              <li key={`${line}-${index}`} className="text-[0.88rem] leading-[1.5] text-ink/70">
                {line}
                {session.verdict?.ruleIds[index] ? (
                  <span className="ml-2 font-mono text-[0.7rem] text-ink/35">
                    {session.verdict.ruleIds[index]}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {session.status === "executed" ? (
        <div className="mt-7 rounded-control border border-ok/25 bg-ok/[0.04] p-5">
          <p className="font-mono text-[0.66rem] uppercase tracking-[0.18em] text-ok">The order</p>
          {session.orderResult ? (
            <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Figure label="Status" value={session.orderResult.status} />
              <Figure label="Filled" value={qty(session.orderResult.executedQty)} />
              <Figure label="Cost" value={usd(session.orderResult.executedQuoteUsd)} />
            </div>
          ) : (
            <p className="mt-2 text-[0.9rem] leading-[1.5] text-ink/70">
              {dryRun
                ? "Dry run, not sent to Binance."
                : "Approved. The fill has not come back yet."}
            </p>
          )}
        </div>
      ) : null}

      {session.status === "failed" ? (
        <p className="mt-6 text-[0.9rem] leading-[1.5] text-bad">
          Binance did not take this order. The ledger line says why.
        </p>
      ) : null}

      {decidable ? (
        <div className="mt-8">
          <div className="flex flex-col gap-3 sm:flex-row">
            <motion.button
              type="button"
              onClick={onApprove}
              disabled={busy !== null}
              whileHover={shouldReduce || busy ? undefined : { scale: 1.02 }}
              whileTap={shouldReduce || busy ? undefined : { scale: 0.99 }}
              transition={{ type: "spring", stiffness: 420, damping: 28 }}
              className="desk-button-amber px-7 py-3.5 text-[0.95rem]"
            >
              {busy === "approve" ? "Sending" : "Approve"}
            </motion.button>
            <button
              type="button"
              onClick={() => setRejecting((open) => !open)}
              disabled={busy !== null}
              className="desk-button-quiet px-7 py-3.5 text-[0.95rem]"
            >
              {busy === "reject" ? "Sending" : "Reject"}
            </button>
          </div>

          <AnimatePresence>
            {rejecting ? (
              <motion.div
                initial={shouldReduce ? { opacity: 1 } : { opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={shouldReduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                  <input
                    className="desk-input min-w-0 flex-1"
                    value={reason}
                    maxLength={500}
                    autoFocus
                    aria-label="Why you are rejecting this"
                    placeholder="One line: why not?"
                    onChange={(event) => setReason(event.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      onReject(reason.trim() === "" ? "The owner gave no reason." : reason.trim());
                      setRejecting(false);
                      setReason("");
                    }}
                    disabled={busy !== null}
                    className="desk-button-bad px-6 py-3 text-[0.9rem]"
                  >
                    {busy === "reject" ? "Sending" : "Record the rejection"}
                  </button>
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      ) : null}

      {problem ? (
        <div className="mt-5" role="alert">
          <p className="text-[0.88rem] leading-[1.45] text-bad">{problem.message}</p>
          <p className="mt-1 text-[0.82rem] leading-[1.45] text-ink/55">{problem.nextStep}</p>
        </div>
      ) : null}
    </motion.section>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="desk-label">{label}</p>
      <p className="mt-1 font-mono text-[0.95rem] text-ink">{value}</p>
    </div>
  );
}
