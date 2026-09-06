"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { OlaiError, getRulebook, putRulebook, say, type ApiIssue, type Rulebook } from "@/lib/api";

/**
 * The rulebook, as a form.
 *
 * Nothing here is enforced in the browser. The agent parses what is sent and
 * hands back the field it refused, which is what the messages under each input
 * are. The placeholders are the starter rulebook the agent ships with, so an
 * empty box still says what a sensible number looks like.
 *
 * In replay the panel is handed the shipped defaults and the whole form is
 * disabled, because there is nothing on the other end to save to.
 */

const STARTER = {
  name: "Olai starter rulebook",
  maxOrderUsd: "20.00",
  maxDailyLossUsd: "10.00",
  maxPositionUsdPerSymbol: "50.00",
  maxDataSpendUsdPerDay: "1.00",
  maxDataSpendUsdPerCall: "0.05",
  requireApprovalAboveUsd: "0.00",
  cooldownSecondsBetweenOrders: "60",
};

type Tier = { lossUsd: string; action: "halve" | "halt" };

/** What each field is called on screen, so a refusal can name it. */
const LABELS: Record<string, string> = {
  name: "What this rulebook is called",
  maxOrderUsd: "Biggest single order",
  maxDailyLossUsd: "Most it may lose in a day",
  maxPositionUsdPerSymbol: "Most held in one market",
  requireApprovalAboveUsd: "Ask me above",
  maxDataSpendUsdPerDay: "Data budget for a day",
  maxDataSpendUsdPerCall: "Most for one data call",
  cooldownSecondsBetweenOrders: "Wait between orders, in seconds",
  allowedSymbols: "Markets it may trade",
  tradingHoursUtc: "Only trade between two hours, UTC",
  drawdownTiers: "Cut back after losing",
};

interface Form {
  name: string;
  maxOrderUsd: string;
  maxDailyLossUsd: string;
  maxPositionUsdPerSymbol: string;
  maxDataSpendUsdPerDay: string;
  maxDataSpendUsdPerCall: string;
  requireApprovalAboveUsd: string;
  cooldownSecondsBetweenOrders: string;
  allowedSymbols: string[];
  allowShort: boolean;
  hours: boolean;
  hoursStart: string;
  hoursEnd: string;
  drawdownTiers: Tier[];
}

function toForm(book: Rulebook): Form {
  return {
    name: book.name,
    maxOrderUsd: book.maxOrderUsd.toFixed(2),
    maxDailyLossUsd: book.maxDailyLossUsd.toFixed(2),
    maxPositionUsdPerSymbol: book.maxPositionUsdPerSymbol.toFixed(2),
    maxDataSpendUsdPerDay: book.maxDataSpendUsdPerDay.toFixed(2),
    maxDataSpendUsdPerCall: book.maxDataSpendUsdPerCall.toFixed(2),
    requireApprovalAboveUsd: book.requireApprovalAboveUsd.toFixed(2),
    cooldownSecondsBetweenOrders: String(book.cooldownSecondsBetweenOrders),
    allowedSymbols: [...book.allowedSymbols],
    allowShort: book.allowShort,
    hours: book.tradingHoursUtc !== undefined,
    hoursStart: String(book.tradingHoursUtc?.start ?? 0),
    hoursEnd: String(book.tradingHoursUtc?.end ?? 23),
    drawdownTiers: book.drawdownTiers.map((tier) => ({
      lossUsd: tier.lossUsd.toFixed(2),
      action: tier.action,
    })),
  };
}

function toRulebook(form: Form): Rulebook {
  const book: Rulebook = {
    version: 1,
    name: form.name.trim(),
    maxOrderUsd: money(form.maxOrderUsd),
    maxDailyLossUsd: money(form.maxDailyLossUsd),
    maxPositionUsdPerSymbol: money(form.maxPositionUsdPerSymbol),
    allowedSymbols: form.allowedSymbols,
    allowShort: form.allowShort,
    allowLeverage: false,
    maxDataSpendUsdPerDay: money(form.maxDataSpendUsdPerDay),
    maxDataSpendUsdPerCall: money(form.maxDataSpendUsdPerCall),
    cooldownSecondsBetweenOrders: whole(form.cooldownSecondsBetweenOrders),
    requireApprovalAboveUsd: money(form.requireApprovalAboveUsd),
    oneSidePerMarket: true,
    drawdownTiers: form.drawdownTiers.map((tier) => ({
      lossUsd: money(tier.lossUsd),
      action: tier.action,
    })),
  };

  if (form.hours) {
    book.tradingHoursUtc = { start: whole(form.hoursStart), end: whole(form.hoursEnd) };
  }

  return book;
}

/** Empty means zero rather than NaN, so the agent gets a number to refuse or accept. */
function money(text: string): number {
  const value = Number.parseFloat(text);
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
}

function whole(text: string): number {
  const value = Number.parseInt(text, 10);
  return Number.isFinite(value) ? value : 0;
}

function issuesByField(issues: ApiIssue[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const issue of issues) {
    const key = (issue.path ?? []).join(".");
    if (!map.has(key)) {
      map.set(key, issue.message);
    }
  }
  return map;
}

export function RulebookPanel({
  token,
  onUnauthorized,
  replay,
  note,
}: {
  token?: string;
  onUnauthorized?: () => void;
  replay?: Rulebook;
  note?: string;
}) {
  const shouldReduce = useReducedMotion() ?? false;
  // A replay already has its rulebook in hand, so the form starts filled rather
  // than waiting on a call it is never going to make.
  const [form, setForm] = useState<Form | null>(replay ? toForm(replay) : null);
  const [loadProblem, setLoadProblem] = useState<{ message: string; nextStep: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [saveProblem, setSaveProblem] = useState<{ message: string; nextStep: string } | null>(null);
  const [issues, setIssues] = useState<ApiIssue[]>([]);
  const [symbolDraft, setSymbolDraft] = useState("");
  const panelRef = useRef<HTMLElement>(null);

  const fieldIssues = useMemo(() => issuesByField(issues), [issues]);
  const refused = issues[0] ? (issues[0].path ?? []) : [];
  const refusedLabel = LABELS[refused.join(".")] ?? LABELS[String(refused[0] ?? "")] ?? null;

  /**
   * The refused field is at the top of a tall panel and the message about it is
   * at the bottom, so on a laptop the two are never on screen together. Saving
   * moves the page to the field and puts the cursor in it.
   */
  const pointAtRefusal = (found: ApiIssue[]) => {
    const path = found[0]?.path ?? [];
    if (path.length === 0) {
      return;
    }
    const keys = [path.join("."), String(path[0])];
    requestAnimationFrame(() => {
      const root = panelRef.current;
      if (!root) {
        return;
      }
      let holder: HTMLElement | null = null;
      for (const key of keys) {
        holder = root.querySelector<HTMLElement>(`[data-field="${key}"]`);
        if (holder) {
          break;
        }
      }
      if (!holder) {
        return;
      }
      holder.scrollIntoView({ block: "center" });
      holder.querySelector<HTMLElement>("input, select, textarea")?.focus({ preventScroll: true });
    });
  };

  const load = useCallback(
    (signal?: AbortSignal) =>
      getRulebook(token ?? "", signal)
        .then((book) => {
          setForm(toForm(book));
          setLoadProblem(null);
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") {
            return;
          }
          if (error instanceof OlaiError && error.unauthorized) {
            onUnauthorized?.();
            return;
          }
          const problem = say(error);
          setLoadProblem({ message: problem.message, nextStep: problem.nextStep });
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
  }, [load, replay]);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm((current) => (current ? { ...current, [key]: value } : current));
    setSavedAt(null);
  };

  const addSymbol = () => {
    const symbol = symbolDraft.trim().toUpperCase();
    if (symbol === "" || !form) {
      return;
    }
    if (!form.allowedSymbols.includes(symbol)) {
      set("allowedSymbols", [...form.allowedSymbols, symbol]);
    }
    setSymbolDraft("");
  };

  const save = async () => {
    if (!form) {
      return;
    }
    setSaving(true);
    setSaveProblem(null);
    setIssues([]);
    try {
      setForm(toForm(await putRulebook(token ?? "", toRulebook(form))));
      setSavedAt(Date.now());
    } catch (error) {
      if (error instanceof OlaiError && error.unauthorized) {
        onUnauthorized?.();
        return;
      }
      const problem = say(error);
      setSaveProblem({ message: problem.message, nextStep: problem.nextStep });
      setIssues(problem.issues);
      pointAtRefusal(problem.issues);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section ref={panelRef} className="desk-panel p-6">
      <header className="flex items-baseline justify-between gap-4">
        <h2 className="desk-heading">Rulebook</h2>
        <span className="font-mono text-[0.62rem] uppercase tracking-[0.18em] text-ink/55">
          {replay ? "Shipped defaults" : "Checked in code"}
        </span>
      </header>

      {replay ? (
        <p className="mt-4 text-[0.85rem] leading-[1.5] text-ink/55">
          The rulebook a fresh install runs under, not a reading of the recorded run.
        </p>
      ) : null}

      {loadProblem ? (
        <div className="mt-5">
          <p className="text-[0.9rem] leading-[1.45] text-bad">{loadProblem.message}</p>
          <p className="mt-1 text-[0.82rem] leading-[1.45] text-ink/55">{loadProblem.nextStep}</p>
          <button type="button" onClick={() => void load()} className="desk-button-quiet mt-4 px-4 py-2 text-[0.82rem]">
            Try again
          </button>
        </div>
      ) : !form ? (
        <div className="mt-6 space-y-3" aria-hidden>
          {[0, 1, 2, 3, 4].map((row) => (
            <div key={`rulebook-skeleton-${row}`} className="desk-skeleton h-9" />
          ))}
        </div>
      ) : (
        <fieldset disabled={replay !== undefined} className="m-0 min-w-0 border-0 p-0">
          <div className="mt-6 flex flex-col gap-5">
            <Field label={LABELS.name} name="name" issue={fieldIssues.get("name")}>
              <input
                className="desk-input"
                value={form.name}
                placeholder={STARTER.name}
                onChange={(event) => set("name", event.target.value)}
              />
            </Field>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Money
                label={LABELS.maxOrderUsd}
                name="maxOrderUsd"
                value={form.maxOrderUsd}
                placeholder={STARTER.maxOrderUsd}
                issue={fieldIssues.get("maxOrderUsd")}
                onChange={(value) => set("maxOrderUsd", value)}
              />
              <Money
                label={LABELS.maxDailyLossUsd}
                name="maxDailyLossUsd"
                value={form.maxDailyLossUsd}
                placeholder={STARTER.maxDailyLossUsd}
                issue={fieldIssues.get("maxDailyLossUsd")}
                onChange={(value) => set("maxDailyLossUsd", value)}
              />
              <Money
                label={LABELS.maxPositionUsdPerSymbol}
                name="maxPositionUsdPerSymbol"
                value={form.maxPositionUsdPerSymbol}
                placeholder={STARTER.maxPositionUsdPerSymbol}
                issue={fieldIssues.get("maxPositionUsdPerSymbol")}
                onChange={(value) => set("maxPositionUsdPerSymbol", value)}
              />
              <Money
                label={LABELS.requireApprovalAboveUsd}
                name="requireApprovalAboveUsd"
                value={form.requireApprovalAboveUsd}
                placeholder={STARTER.requireApprovalAboveUsd}
                issue={fieldIssues.get("requireApprovalAboveUsd")}
                onChange={(value) => set("requireApprovalAboveUsd", value)}
              />
              <Money
                label={LABELS.maxDataSpendUsdPerDay}
                name="maxDataSpendUsdPerDay"
                value={form.maxDataSpendUsdPerDay}
                placeholder={STARTER.maxDataSpendUsdPerDay}
                issue={fieldIssues.get("maxDataSpendUsdPerDay")}
                onChange={(value) => set("maxDataSpendUsdPerDay", value)}
              />
              <Money
                label={LABELS.maxDataSpendUsdPerCall}
                name="maxDataSpendUsdPerCall"
                value={form.maxDataSpendUsdPerCall}
                placeholder={STARTER.maxDataSpendUsdPerCall}
                issue={fieldIssues.get("maxDataSpendUsdPerCall")}
                onChange={(value) => set("maxDataSpendUsdPerCall", value)}
              />
            </div>

            <Field
              label={LABELS.cooldownSecondsBetweenOrders}
              name="cooldownSecondsBetweenOrders"
              issue={fieldIssues.get("cooldownSecondsBetweenOrders")}
            >
              <input
                className="desk-input"
                inputMode="numeric"
                value={form.cooldownSecondsBetweenOrders}
                placeholder={STARTER.cooldownSecondsBetweenOrders}
                onChange={(event) => set("cooldownSecondsBetweenOrders", event.target.value)}
              />
            </Field>

            <Field
              label={LABELS.allowedSymbols}
              name="allowedSymbols"
              issue={fieldIssues.get("allowedSymbols")}
            >
              <div className="flex flex-wrap items-center gap-2">
                {form.allowedSymbols.map((symbol) => (
                  <span key={symbol} className="desk-chip">
                    {symbol}
                    <button
                      type="button"
                      aria-label={`Remove ${symbol}`}
                      onClick={() =>
                        set(
                          "allowedSymbols",
                          form.allowedSymbols.filter((entry) => entry !== symbol),
                        )
                      }
                      className="desk-remove"
                    >
                      ×
                    </button>
                  </span>
                ))}
                <input
                  className="desk-input w-[9rem] py-2 font-mono text-[0.8rem] uppercase"
                  value={symbolDraft}
                  placeholder="BNBUSDT"
                  aria-label="Add a market"
                  onChange={(event) => setSymbolDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === ",") {
                      event.preventDefault();
                      addSymbol();
                    }
                  }}
                  onBlur={addSymbol}
                />
              </div>
            </Field>

            <div className="flex flex-col gap-3">
              <Switch
                label="May sell what it does not hold"
                checked={form.allowShort}
                onChange={(value) => set("allowShort", value)}
              />
              <Switch
                label={LABELS.tradingHoursUtc}
                checked={form.hours}
                onChange={(value) => set("hours", value)}
              />
              {form.hours ? (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field
                    label="From hour"
                    name="tradingHoursUtc.start"
                    issue={fieldIssues.get("tradingHoursUtc.start")}
                  >
                    <input
                      className="desk-input"
                      inputMode="numeric"
                      value={form.hoursStart}
                      onChange={(event) => set("hoursStart", event.target.value)}
                    />
                  </Field>
                  <Field
                    label="To hour"
                    name="tradingHoursUtc.end"
                    issue={fieldIssues.get("tradingHoursUtc.end")}
                  >
                    <input
                      className="desk-input"
                      inputMode="numeric"
                      value={form.hoursEnd}
                      onChange={(event) => set("hoursEnd", event.target.value)}
                    />
                  </Field>
                </div>
              ) : null}
              {fieldIssues.get("tradingHoursUtc") ? (
                <p className="text-[0.78rem] leading-[1.4] text-bad">
                  {fieldIssues.get("tradingHoursUtc")}
                </p>
              ) : null}
            </div>

            <div data-field="drawdownTiers">
              <p className="desk-label">{LABELS.drawdownTiers}</p>
              <div className="mt-3 flex flex-col gap-2">
                {form.drawdownTiers.map((tier, index) => (
                  <div key={`tier-${index}`} className="flex items-center gap-2">
                    <span className="font-mono text-[0.8rem] text-ink/55">$</span>
                    <input
                      className="desk-input min-w-0 flex-1 basis-0 py-2 font-mono text-[0.82rem]"
                      inputMode="decimal"
                      value={tier.lossUsd}
                      onChange={(event) => {
                        const next = [...form.drawdownTiers];
                        next[index] = { ...tier, lossUsd: event.target.value };
                        set("drawdownTiers", next);
                      }}
                    />
                    <select
                      className="desk-input w-[7.5rem] shrink-0 basis-[7.5rem] py-2 text-[0.82rem]"
                      value={tier.action}
                      onChange={(event) => {
                        const next = [...form.drawdownTiers];
                        next[index] = { ...tier, action: event.target.value as Tier["action"] };
                        set("drawdownTiers", next);
                      }}
                    >
                      <option value="halve">halve size</option>
                      <option value="halt">stop trading</option>
                    </select>
                    <button
                      type="button"
                      aria-label="Remove this tier"
                      onClick={() =>
                        set(
                          "drawdownTiers",
                          form.drawdownTiers.filter((_, position) => position !== index),
                        )
                      }
                      className="desk-remove shrink-0"
                    >
                      ×
                    </button>
                  </div>
                ))}
                {[...fieldIssues.entries()]
                  .filter(([key]) => key.startsWith("drawdownTiers"))
                  .map(([key, message]) => (
                    <p key={key} className="text-[0.78rem] leading-[1.4] text-bad">
                      {message}
                    </p>
                  ))}
                <button
                  type="button"
                  onClick={() => set("drawdownTiers", [...form.drawdownTiers, { lossUsd: "0.00", action: "halve" }])}
                  className="desk-button-quiet mt-1 w-fit px-4 py-2 text-[0.8rem]"
                >
                  Add a tier
                </button>
              </div>
            </div>

            <div className="rounded-control border border-ink/10 bg-ink/[0.02] p-4">
              <p className="font-mono text-[0.62rem] uppercase tracking-[0.18em] text-ink/55">
                Not yours to change
              </p>
              <p className="mt-2 text-[0.85rem] leading-[1.5] text-ink/55">
                Leverage is off and one side per market is on. Olai is a spot agent, so these are
                not settings, they are things it cannot do.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <motion.button
                type="button"
                onClick={() => void save()}
                disabled={saving}
                whileHover={shouldReduce || saving ? undefined : { scale: 1.02 }}
                whileTap={shouldReduce || saving ? undefined : { scale: 0.99 }}
                transition={{ type: "spring", stiffness: 420, damping: 28 }}
                className="desk-button-amber px-6 py-3 text-[0.88rem]"
              >
                {saving ? "Saving…" : "Save the rulebook"}
              </motion.button>
              <AnimatePresence>
                {savedAt ? (
                  <motion.span
                    key={savedAt}
                    initial={shouldReduce ? { opacity: 1 } : { opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="font-mono text-[0.72rem] uppercase tracking-[0.16em] text-ok"
                  >
                    Saved, and recorded in the ledger
                  </motion.span>
                ) : null}
              </AnimatePresence>
              {note ? (
                <span className="font-mono text-[0.72rem] uppercase tracking-[0.16em] text-ink/55">
                  {note}
                </span>
              ) : null}
            </div>

            {saveProblem ? (
              <div role="alert">
                <p className="text-[0.88rem] leading-[1.45] text-bad">{saveProblem.message}</p>
                <p className="mt-1 text-[0.82rem] leading-[1.45] text-ink/55">
                  {refusedLabel
                    ? `Fix ${refusedLabel} below and send it again.`
                    : saveProblem.nextStep}
                </p>
              </div>
            ) : null}
          </div>
        </fieldset>
      )}
    </section>
  );
}

function Field({
  label,
  name,
  issue,
  children,
}: {
  label: string;
  name?: string;
  issue?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block" data-field={name}>
      <span className="desk-label">{label}</span>
      <span className="mt-2 block">{children}</span>
      {issue ? <span className="mt-1.5 block text-[0.78rem] leading-[1.4] text-bad">{issue}</span> : null}
    </label>
  );
}

function Money({
  label,
  name,
  value,
  placeholder,
  issue,
  onChange,
}: {
  label: string;
  name: string;
  value: string;
  placeholder: string;
  issue?: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={label} name={name} issue={issue}>
      <span className="relative block">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-[0.8rem] text-ink/55">
          $
        </span>
        <input
          className="desk-input pl-7 font-mono text-[0.88rem]"
          inputMode="decimal"
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          onBlur={(event) => {
            const parsed = Number.parseFloat(event.target.value);
            if (Number.isFinite(parsed)) {
              onChange(parsed.toFixed(2));
            }
          }}
        />
      </span>
    </Field>
  );
}

function Switch({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="group flex items-center justify-between gap-4 rounded-control border border-ink/10 px-4 py-3 text-left transition-colors duration-300 hover:border-ink/25"
    >
      <span className="text-[0.88rem] text-ink/75">{label}</span>
      <span className={`desk-mini-toggle ${checked ? "is-on" : ""}`}>
        <span className="desk-mini-knob" />
      </span>
    </button>
  );
}
