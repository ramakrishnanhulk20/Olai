"use client";

import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { ProposalStatus, SessionRecord } from "@/lib/api";
import { bscscan, host, percent, shortHash, usd } from "@/lib/format";

/**
 * The one card on the screen that carries a decision.
 *
 * The rulebook verdict sits above the two buttons on purpose: the owner should
 * see what the rules already said, and which rule said it, before deciding
 * anything. In replay the card prints only what the ledger export carries, so
 * confidence, the reasoning and the risk list are left out rather than filled in.
 */

const STATUS: Record<ProposalStatus, { label: string; tone: string; dot: string }> = {
  pending: { label: "Waiting for you", tone: "text-warn", dot: "bg-warn" },
  approved: { label: "Approved", tone: "text-ok", dot: "bg-ok" },
  executed: { label: "Done", tone: "text-ok", dot: "bg-ok" },
  refused: { label: "Refused by the rulebook", tone: "text-bad", dot: "bg-bad" },
  rejected: { label: "You said no", tone: "text-ink/60", dot: "bg-ink/40" },
  failed: { label: "It did not go through", tone: "text-bad", dot: "bg-bad" },
};

export function ProposalCard({
  session,
  replay = false,
  fillSentence,
  busy = null,
  problem = null,
  onApprove,
  onReject,
}: {
  session: SessionRecord;
  replay?: boolean;
  fillSentence?: string;
  busy?: "approve" | "reject" | null;
  problem?: { message: string; nextStep: string } | null;
  onApprove?: () => void;
  onReject?: (reason: string) => void;
}) {
  const shouldReduce = useReducedMotion() ?? false;
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  const proposal = session.proposal;
  if (!proposal) {
    return null;
  }

  const status = STATUS[session.status];
  const order = proposal.action.type === "order" ? proposal.action : null;
  const decidable = !replay && session.status === "pending" && order !== null;

  return (
    <motion.section
      layout={!shouldReduce}
      initial={shouldReduce ? { opacity: 1 } : { opacity: 0, y: 22 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      className="conv-card p-6 sm:p-8"
      aria-label="Olai's proposal"
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2.5 font-mono text-[0.66rem] uppercase tracking-[0.2em] text-amber">
          <span className="block size-2 rounded-[2px] bg-amber" />
          The proposal
        </p>
        <span
          className={`inline-flex items-center gap-2 font-mono text-[0.66rem] uppercase tracking-[0.18em] ${status.tone}`}
        >
          <span className={`block size-1.5 rounded-[2px] ${status.dot}`} />
          {status.label}
        </span>
      </header>

      <p className="conv-action mt-5">
        {order ? `${order.side} ${order.symbol} for ${usd(order.quoteUsd)}` : "HOLD"}
      </p>

      {order && !replay ? (
        <p className="mt-2 font-mono text-[0.72rem] uppercase tracking-[0.16em] text-ink/60">
          {order.orderType}
          {order.limitPrice === undefined ? "" : ` at ${usd(order.limitPrice)}`}
        </p>
      ) : null}

      <p className="mt-5 max-w-[60ch] text-[1.02rem] leading-[1.55] text-ink/85">
        {proposal.summary}
      </p>

      {proposal.action.type === "hold" ? (
        <p className="mt-3 max-w-[58ch] text-[0.92rem] leading-[1.5] text-ink/65">
          {proposal.action.reason}
        </p>
      ) : null}

      {replay ? null : (
        <div className="mt-7 max-w-[22rem]">
          <div className="flex items-baseline justify-between">
            <span className="desk-label">How sure it is</span>
            <span className="font-mono text-[0.72rem] text-ink/60">
              {percent(proposal.confidence)}
            </span>
          </div>
          <div className="desk-meter mt-2" aria-hidden>
            <motion.span
              initial={shouldReduce ? false : { width: 0 }}
              animate={{ width: percent(proposal.confidence) }}
              transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
            />
          </div>
        </div>
      )}

      {proposal.reasoning ? (
        <p className="mt-6 max-w-[64ch] text-[0.92rem] leading-[1.6] text-ink/65">
          {proposal.reasoning}
        </p>
      ) : null}

      <div className="mt-7 grid gap-6 sm:grid-cols-2">
        <div>
          <p className="desk-label">Data it says it used</p>
          <p className="mt-1.5 text-[0.78rem] leading-[1.4] text-ink/55">
            the model writes this list, the receipt is the record
          </p>
          {proposal.dataUsed.length === 0 ? (
            <p className="mt-2 text-[0.85rem] text-ink/60">Nothing bought for this one.</p>
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
                        className="conv-link"
                      >
                        {shortHash(item.txHash)}
                      </a>
                    ) : (
                      <span className="font-mono text-[0.72rem] text-ink/55">no tx</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <p className="desk-label">What could go wrong</p>
          {replay ? (
            <p className="mt-2 text-[0.85rem] leading-[1.5] text-ink/60">
              The export does not carry the risk list.
            </p>
          ) : proposal.risks.length === 0 ? (
            <p className="mt-2 text-[0.85rem] text-ink/60">Olai named no risks.</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {proposal.risks.map((risk) => (
                <li key={risk} className="flex gap-2.5 text-[0.88rem] leading-[1.5] text-ink/70">
                  <span className="mt-[0.5rem] block size-1.5 shrink-0 rounded-[2px] bg-ink/30" />
                  {risk}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

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
          <p className="mt-2 font-mono text-[0.72rem] text-ink/60">
            {replay
              ? session.verdict.requiresApproval
                ? "Your approval required"
                : ""
              : `Biggest order the rules allow right now ${usd(session.verdict.effectiveMaxOrderUsd)}${
                  session.verdict.requiresApproval ? " · your approval required" : ""
                }`}
          </p>
          <ul className="mt-3 flex flex-col gap-2">
            {session.verdict.reasons.map((line, index) => (
              <li key={`${line}-${index}`} className="text-[0.88rem] leading-[1.5] text-ink/75">
                {line}
                {session.verdict?.ruleIds[index] ? (
                  <span className="ml-2 font-mono text-[0.7rem] text-ink/55">
                    {session.verdict.ruleIds[index]}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {decidable ? (
        <div className="mt-8">
          <div className="flex flex-col gap-3 sm:flex-row">
            <motion.button
              type="button"
              onClick={() => onApprove?.()}
              disabled={busy !== null}
              whileHover={shouldReduce || busy ? undefined : { scale: 1.02 }}
              whileTap={shouldReduce || busy ? undefined : { scale: 0.99 }}
              transition={{ type: "spring", stiffness: 420, damping: 28 }}
              className="desk-button-amber min-h-[44px] px-7 py-3.5 text-[0.95rem]"
            >
              {busy === "approve" ? "Sending" : "Approve"}
            </motion.button>
            <button
              type="button"
              onClick={() => setRejecting((open) => !open)}
              disabled={busy !== null}
              aria-expanded={rejecting}
              className="desk-button-quiet min-h-[44px] px-7 py-3.5 text-[0.95rem]"
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
                      onReject?.(reason.trim() === "" ? "The owner gave no reason." : reason.trim());
                      setRejecting(false);
                      setReason("");
                    }}
                    disabled={busy !== null}
                    className="desk-button-bad min-h-[44px] px-6 py-3 text-[0.9rem]"
                  >
                    {busy === "reject" ? "Sending" : "Record the rejection"}
                  </button>
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      ) : null}

      {replay ? (
        <div className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2">
          <button
            type="button"
            disabled
            className="desk-button-quiet min-h-[44px] px-7 py-3.5 text-[0.95rem]"
            title="The owner approved this one when the run was recorded."
          >
            Approved in the recorded run
          </button>
          {fillSentence ? (
            <span className="text-[0.9rem] leading-[1.45] text-ok">{fillSentence}</span>
          ) : null}
        </div>
      ) : null}

      {!replay && !decidable && proposal.action.type === "hold" ? (
        <p className="mt-7 text-[0.92rem] leading-[1.5] text-ink/65">
          Olai recommends holding. Nothing to approve.
        </p>
      ) : null}

      {problem ? (
        <div className="mt-5" role="alert">
          <p className="text-[0.88rem] leading-[1.45] text-bad">{problem.message}</p>
          <p className="mt-1 text-[0.82rem] leading-[1.45] text-ink/60">{problem.nextStep}</p>
        </div>
      ) : null}
    </motion.section>
  );
}
