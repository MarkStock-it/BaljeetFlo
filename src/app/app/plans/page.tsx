"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CalendarIcon,
  CheckIcon,
  ChevronLeftIcon,
  ClockIcon,
  PlusIcon,
  RepeatIcon,
  TargetIcon,
  TrashIcon,
} from "@/components/icons";
import { allocationStatus } from "@/lib/engine/plans";
import { dayKey, parseDay } from "@/lib/day";
import { refreshBudget, useBudgetSnapshot } from "@/lib/budget-snapshot";

type Projection = {
  saved: number;
  remaining: number;
  pct: number;
  monthsToTarget: number | null;
  projectedDate: string | null;
  onTrack: boolean | null;
  requiredMonthly: number | null;
  finished: boolean;
  paused: boolean;
};
type ApiPlan = {
  id: string;
  name: string;
  targetAmount: number;
  savedAmount: number;
  monthlySetAside: number;
  targetDate: string | null;
  status: "active" | "done" | "paused";
  note: string | null;
  projection: Projection;
  sentence: string;
};
type Budget = {
  income: number;
  hardSavingsGoal: number;
  categories: {
    id: string;
    name: string;
    flexible: boolean;
    cap: number;
    spent: number;
    remaining: number;
  }[];
  planReserved: number;
  plans: { id: string; monthlySetAside: number }[];
};

/** A recurring payment as the API describes it. */
type Sched = {
  id: string;
  name: string;
  amount: number;
  categoryId: string | null;
  categoryName: string | null;
  cadence: "daily" | "weekly" | "monthly";
  weekdays: number[];
  dayOfMonth: number | null;
  startDate: string;
  endDate: string | null;
  active: boolean;
  lastPostedOn: string | null;
  schedule: string;
  sentence: string;
  nextDate: string | null;
  occurrencesLeft: number;
  committedThisMonth: number;
  monthlyEstimate: number;
};

const WEEKDAYS = [
  { n: 1, label: "M" },
  { n: 2, label: "T" },
  { n: 3, label: "W" },
  { n: 4, label: "T" },
  { n: 5, label: "F" },
  { n: 6, label: "S" },
  { n: 0, label: "S" },
];

const peso = (n: number) =>
  `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pesoShort = (n: number) => `₱${Math.round(n).toLocaleString("en-PH")}`;

/** Was this schedule's charge already posted today? */
const postedToday = (s: Sched) => s.lastPostedOn === dayKey();
const num = (s: string) => {
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const monthYear = (iso: string | null) =>
  iso
    ? (parseDay(iso) ?? new Date(iso)).toLocaleDateString("en-PH", {
        month: "long",
        year: "numeric",
      })
    : null;

/**
 * The card already says the plan's name, so this line only says where it lands.
 * The server's `sentence` includes the name for chat and reports, so it isn't
 * reused here.
 */
function statusLine(p: ApiPlan): string {
  const proj = p.projection;
  if (proj.finished) return "Fully funded.";
  if (proj.paused) return "Paused, so nothing is being set aside.";
  if (proj.monthsToTarget === null) return "No monthly set-aside yet.";
  if (proj.onTrack === false) {
    return `Behind. ${peso(proj.requiredMonthly ?? 0)} a month keeps ${monthYear(p.targetDate)}.`;
  }
  return `Arrives around ${monthYear(proj.projectedDate)}.`;
}

type Prefill = { name: string; target: string; monthly: string; deadline: string };

export default function PlansPage() {
  const [prefill, setPrefill] = useState<Prefill | null>(null);
  const [plans, setPlans] = useState<ApiPlan[] | null>(null);
  // Shared snapshot: the caps this sheet reads are already in memory, so the
  // screen never opens against an empty budget.
  const budget = useBudgetSnapshot();
  const [schedules, setSchedules] = useState<Sched[] | null>(null);
  const [schedSheet, setSchedSheet] = useState<Sched | "new" | null>(null);
  const [editing, setEditing] = useState<ApiPlan | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [p, s] = await Promise.all([
      fetch("/api/plans").then((r) => (r.ok ? r.json() : { plans: [] })),
      fetch("/api/recurring").then((r) => (r.ok ? r.json() : { recurring: [] })),
    ]);
    setPlans(p.plans ?? []);
    void refreshBudget();
    setSchedules(s.recurring ?? []);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Arriving from chat with "I'm saving for a laptop, 45,000 by March".
  // Read from the URL directly so this page needs no Suspense boundary.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const target = q.get("target");
    if (!target || num(target) <= 0) return;
    setPrefill({
      name: q.get("name") ?? "",
      target,
      monthly: q.get("monthly") ?? "",
      deadline: q.get("deadline") ?? "",
    });
    setCreating(true);
    setError(null);
  }, []);

  const active = (plans ?? []).filter((p) => p.status === "active");
  const done = (plans ?? []).filter((p) => p.status !== "active");
  const reserved = active.reduce((s, p) => s + p.monthlySetAside, 0);

  return (
    <main className="px-5 pt-12">
      <h1 className="text-[26px] font-bold tracking-[-0.02em]">Plans</h1>
      <p className="sub mt-1.5 max-w-[38ch]">
        Money you&apos;ve already promised: the fares and subscriptions that come round again, and the
        things you&apos;re saving up for. Neither can be spent on impulse, which is the point.
      </p>

      {/* ── Recurring ─────────────────────────────────────────────────── */}
      <section className="mt-7">
        <div className="flex items-center gap-2.5">
          <RepeatIcon size={16} />
          <h2 className="text-[15px] font-semibold">On a schedule</h2>
          {schedules && schedules.length > 0 && (
            <span className="micro ml-auto num">
              {pesoShort(schedules.filter((s) => s.active).reduce((t, s) => t + s.committedThisMonth, 0))} still
              to come this month
            </span>
          )}
        </div>

        {schedules === null && <p className="micro mt-4">Loading…</p>}

        {schedules?.length === 0 && (
          <div className="card mt-3 p-5">
            <p className="text-[15px] leading-relaxed">
              Nothing on a rhythm yet. If you pay the same thing regularly, transport on class days
              or data on Mondays, set it once and it lands on its own.
            </p>
          </div>
        )}

        {schedules && schedules.length > 0 && (
          <div className="card-solid rows mt-3">
            {schedules.map((s) => (
              <button
                key={s.id}
                className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
                onClick={() => {
                  setError(null);
                  setSchedSheet(s);
                }}
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-[15px] font-medium">{s.name}</span>
                    {!s.active && <span className="tag" data-tone="quiet">Paused</span>}
                    {s.active && postedToday(s) && (
                      <span className="tag" data-tone="good">In today</span>
                    )}
                  </span>
                  <span className="micro mt-0.5 block truncate">{s.sentence}</span>
                </span>
                <span className="num shrink-0 text-right">
                  <span className="block text-[15px] font-semibold">−{peso(s.amount)}</span>
                  <span className="micro block">
                    {s.categoryName ? s.categoryName : "Uncategorized"}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}

        <button
          className="btn-ghost mt-3 w-full"
          onClick={() => {
            setError(null);
            setSchedSheet("new");
          }}
        >
          <RepeatIcon size={16} />
          Add a scheduled payment
        </button>
      </section>

      {/* ── Plans ─────────────────────────────────────────────────────── */}
      <h2 className="mt-9 text-[15px] font-semibold">Saving up</h2>

      {plans === null && <p className="micro mt-8">Loading your plans…</p>}

      {plans?.length === 0 && (
        <div className="card mt-3 p-5">
          <p className="text-[15px] leading-relaxed">
            Nothing you&apos;re saving up for yet. A plan takes a fixed slice of each month and locks it
            away from impulse.
          </p>
          <p className="micro mt-2.5 leading-relaxed">
            Or just say it in chat: “I&apos;m saving up for a laptop, ₱45,000 by March.”
          </p>
        </div>
      )}

      {active.length > 0 && (
        <p className="micro mt-3">
          {active.length} active · {pesoShort(reserved)} reserved every month
        </p>
      )}

      <div className="mt-3 space-y-3">
        {active.map((p) => (
          <button
            key={p.id}
            className="card-solid block w-full p-5 text-left"
            onClick={() => {
              setError(null);
              setEditing(p);
            }}
          >
            <div className="flex items-center gap-3">
              <h2 className="min-w-0 flex-1 truncate text-[17px] font-bold">{p.name}</h2>
              {p.projection.onTrack === false && <span className="tag" data-tone="warn">Behind</span>}
              {p.projection.onTrack === true && (
                <span className="tag" data-tone="good">
                  On track
                </span>
              )}
              {p.projection.onTrack === null && p.projection.monthsToTarget !== null && (
                <span className="tag" data-tone="quiet">
                  {p.projection.monthsToTarget} mo
                </span>
              )}
            </div>

            <div className="bar mt-4">
              <i style={{ width: `${Math.round(p.projection.pct * 100)}%` }} />
            </div>

            <div className="mt-2.5 flex items-baseline justify-between">
              <p className="num text-[15px] font-semibold">{peso(p.projection.saved)}</p>
              <p className="micro num">of {peso(p.targetAmount)}</p>
            </div>

            <p className="sub mt-3 text-[13.5px] leading-relaxed">{statusLine(p)}</p>
            <p className="micro num mt-1.5">
              {pesoShort(p.monthlySetAside)} set aside monthly
              {p.targetDate ? ` · due ${monthYear(p.targetDate)}` : ""}
            </p>
          </button>
        ))}
      </div>

      {done.length > 0 && (
        <>
          <h2 className="micro mt-8">Funded or paused</h2>
          <div className="card-solid rows mt-2">
            {done.map((p) => (
              <button
                key={p.id}
                className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
                onClick={() => {
                  setError(null);
                  setEditing(p);
                }}
              >
                <span className="min-w-0 flex-1 truncate text-[15px]">{p.name}</span>
                <span className="micro">
                  {p.status === "done" ? "Fully funded" : "Paused"}
                </span>
                <ChevronLeftIcon size={16} className="rotate-180" />
              </button>
            ))}
          </div>
        </>
      )}

      {error && <p className="warn-text mt-4 text-[14px]">{error}</p>}

      <button
        className="btn-ghost mb-10 mt-3 w-full"
        onClick={() => {
          setError(null);
          setCreating(true);
        }}
      >
        <PlusIcon size={16} />
        Add a plan
      </button>

      {schedSheet && budget && (
        <RecurringSheet
          schedule={schedSheet === "new" ? null : schedSheet}
          budget={budget}
          onClose={() => setSchedSheet(null)}
          onChanged={(next) => setSchedules(next)}
        />
      )}

      {(creating || editing) && budget && (
        <PlanSheet
          plan={editing}
          prefilled={editing ? null : prefill}
          budget={budget}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onChanged={(next) => {
            if (next) setPlans(next);
            refresh();
          }}
        />
      )}
    </main>
  );
}

/**
 * One sheet for creating and editing a schedule.
 *
 * The live footer answers the only question that matters: what does this
 * rhythm cost me every month, before anything is saved.
 */
function RecurringSheet({
  schedule,
  budget,
  onClose,
  onChanged,
}: {
  schedule: Sched | null;
  budget: Budget;
  onClose: () => void;
  onChanged: (next: Sched[] | null) => void;
}) {
  const flexible = budget.categories.filter((c) => c.flexible);
  const [name, setName] = useState(schedule?.name ?? "");
  const [amount, setAmount] = useState(schedule ? String(schedule.amount) : "");
  const [categoryId, setCategoryId] = useState(schedule?.categoryId ?? flexible[0]?.id ?? "");
  const [cadence, setCadence] = useState<Sched["cadence"]>(schedule?.cadence ?? "weekly");
  const [weekdays, setWeekdays] = useState<number[]>(schedule?.weekdays ?? [1, 3, 5]);
  const [dayOfMonth, setDayOfMonth] = useState(
    schedule?.dayOfMonth ? String(schedule.dayOfMonth) : String(new Date().getDate())
  );
  const [stopAfter, setStopAfter] = useState(schedule?.endDate ?? "");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const perMonth =
    num(amount) *
    (cadence === "daily"
      ? 30.4
      : cadence === "monthly"
        ? 1
        : Math.max(1, weekdays.length) * 4.35);
  const category = flexible.find((c) => c.id === categoryId);
  // A rhythm that costs more than its category holds every month is a real
  // mismatch, and the pace would have to absorb it, so say so before saving.
  const tight = category ? perMonth > category.cap : false;

  async function submit() {
    setBusy(true);
    setLocalError(null);
    const payload = {
      name: name.trim(),
      amount: num(amount),
      categoryId,
      cadence,
      weekdays,
      dayOfMonth: cadence === "monthly" ? Number(dayOfMonth) : null,
      endDate: stopAfter || null,
    };
    const res = await fetch("/api/recurring", {
      method: schedule ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(schedule ? { id: schedule.id, ...payload } : payload),
    });
    setBusy(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setLocalError(data.error ?? "That didn't save.");
      return;
    }
    onChanged(data.recurring ?? null);
    onClose();
  }

  async function patch(body: Record<string, unknown>) {
    if (!schedule) return;
    setBusy(true);
    setLocalError(null);
    const res = await fetch("/api/recurring", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: schedule.id, ...body }),
    });
    setBusy(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setLocalError(data.error ?? "That didn't save.");
    onChanged(data.recurring ?? null);
    onClose();
  }

  async function skipToday() {
    if (!schedule) return;
    setBusy(true);
    setLocalError(null);
    const res = await fetch("/api/recurring", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "skip", id: schedule.id }),
    });
    setBusy(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setLocalError(data.error ?? "Nothing to remove for today.");
    onChanged(data.recurring ?? null);
    onClose();
  }

  async function remove() {
    if (!schedule) return;
    setBusy(true);
    const res = await fetch(`/api/recurring?id=${schedule.id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) return setLocalError("That didn't delete.");
    const data = await res.json();
    onChanged(data.recurring ?? null);
    onClose();
  }

  return (
    <div className="sheet-scrim" onClick={onClose}>
      <div className="sheet-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Scheduled payment">
        <div className="flex items-center gap-3">
          <span
            className="inline-flex h-9 w-9 items-center justify-center rounded-full"
            style={{ background: "var(--paper-2)", color: "var(--ink-2)" }}
          >
            <RepeatIcon size={17} />
          </span>
          <h3 className="text-[17px] font-bold">{schedule ? schedule.name : "Scheduled payment"}</h3>
        </div>

        <div className="mt-5 space-y-4">
          <label className="block">
            <span className="micro mb-1.5 block">What is it?</span>
            <input
              className="field"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Transport"
              aria-label="Name"
            />
          </label>

          <label className="block">
            <span className="micro mb-1.5 block">How much each time?</span>
            <input
              inputMode="decimal"
              className="field num"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="100"
              aria-label="Amount"
            />
          </label>

          <div>
            <span className="micro mb-1.5 block">Which category pays for it?</span>
            <div className="flex flex-wrap gap-2">
              {flexible.map((c) => (
                <button
                  key={c.id}
                  className="chip"
                  style={
                    categoryId === c.id
                      ? { borderColor: "var(--accent)", color: "var(--accent)", fontWeight: 600 }
                      : undefined
                  }
                  aria-pressed={categoryId === c.id}
                  onClick={() => setCategoryId(c.id)}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="micro mb-1.5 block">How often?</span>
            <div className="grid grid-cols-3 gap-2">
              {(["daily", "weekly", "monthly"] as const).map((c) => (
                <button
                  key={c}
                  className="chip text-center"
                  style={
                    cadence === c
                      ? { borderColor: "var(--accent)", color: "var(--accent)", fontWeight: 600 }
                      : undefined
                  }
                  aria-pressed={cadence === c}
                  onClick={() => setCadence(c)}
                >
                  {c === "daily" ? "Every day" : c === "weekly" ? "Certain days" : "Monthly"}
                </button>
              ))}
            </div>
          </div>

          {cadence === "weekly" && (
            <div>
              <span className="micro mb-1.5 block">Which days?</span>
              <div className="flex gap-2">
                {WEEKDAYS.map((d, i) => {
                  const on = weekdays.includes(d.n);
                  return (
                    <button
                      key={`${d.n}-${i}`}
                      className="flex-1 rounded-full py-2 text-[13.5px] font-medium"
                      style={{
                        border: `1px solid ${on ? "var(--accent)" : "var(--hairline-strong)"}`,
                        background: on ? "var(--accent)" : "transparent",
                        color: on ? "#fff" : "var(--ink)",
                      }}
                      aria-pressed={on}
                      aria-label={["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][d.n]}
                      onClick={() =>
                        setWeekdays(
                          on ? weekdays.filter((x) => x !== d.n) : [...weekdays, d.n]
                        )
                      }
                    >
                      {d.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {cadence === "monthly" && (
            <label className="block">
              <span className="micro mb-1.5 block">Which day of the month?</span>
              <input
                inputMode="numeric"
                className="field num"
                value={dayOfMonth}
                onChange={(e) => setDayOfMonth(e.target.value)}
                aria-label="Day of month"
              />
            </label>
          )}

          <label className="block">
            <span className="micro mb-1.5 block">Stop after (optional)</span>
            <input
              type="date"
              className="field num"
              value={stopAfter}
              min={dayKey()}
              onChange={(e) => setStopAfter(e.target.value)}
              aria-label="Stop after"
            />
          </label>
        </div>

        {num(amount) > 0 && category && (
          <p className={`mt-4 text-[13.5px] leading-relaxed ${tight ? "warn-text" : "text-[var(--ink-2)]"}`}>
            About {pesoShort(perMonth)} a month out of {category.name}&apos;s {pesoShort(category.cap)}
            {tight
              ? ". That's more than that category holds, so the pace will have to absorb the rest."
              : `, ${pesoShort(category.remaining)} of it still free this month.`}
          </p>
        )}

        {schedule && (
          <div className="mt-5 flex flex-wrap gap-2">
            {postedToday(schedule) && (
              <button className="chip" disabled={busy} onClick={skipToday}>
                <span className="inline-flex items-center gap-1.5">
                  <TrashIcon size={13} />
                  Remove today&apos;s charge
                </span>
              </button>
            )}
            <button className="chip" disabled={busy} onClick={() => patch({ active: !schedule.active })}>
              <span className="inline-flex items-center gap-1.5">
                <ClockIcon size={13} />
                {schedule.active ? "Pause" : "Resume"}
              </span>
            </button>
            <button className="chip" disabled={busy} onClick={remove}>
              <span className="inline-flex items-center gap-1.5" style={{ color: "var(--ink-2)" }}>
                <TrashIcon size={13} />
                Delete schedule
              </span>
            </button>
          </div>
        )}

        {schedule?.endDate && (
          <p className="micro mt-3 inline-flex items-center gap-1.5">
            <CalendarIcon size={12} />
            Stops after {monthYear(schedule.endDate)}
          </p>
        )}

        {localError && <p className="warn-text mt-3 text-[14px]">{localError}</p>}

        <button
          className="btn-primary mt-5 w-full"
          onClick={submit}
          disabled={
            busy ||
            !name.trim() ||
            num(amount) <= 0 ||
            !categoryId ||
            (cadence === "weekly" && weekdays.length === 0)
          }
        >
          {busy ? "Saving…" : schedule ? "Save changes" : "Start it"}
        </button>
        <button className="btn-ghost mt-2.5 w-full" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function PlanSheet({
  plan,
  prefilled,
  budget,
  onClose,
  onChanged,
}: {
  plan: ApiPlan | null;
  prefilled: { name: string; target: string; monthly: string; deadline: string } | null;
  budget: Budget;
  onClose: () => void;
  onChanged: (plans: ApiPlan[] | null) => void;
}) {
  const [name, setName] = useState(plan?.name ?? prefilled?.name ?? "");
  const [target, setTarget] = useState(plan ? String(plan.targetAmount) : prefilled?.target ?? "");
  const [monthly, setMonthly] = useState(
    plan ? String(plan.monthlySetAside) : prefilled?.monthly ?? ""
  );
  const [deadline, setDeadline] = useState(plan?.targetDate ?? prefilled?.deadline ?? "");
  const [contribution, setContribution] = useState("");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const othersReserved = budget.plans
    .filter((p) => p.id !== plan?.id)
    .reduce((s, p) => s + p.monthlySetAside, 0);
  const status = allocationStatus({
    income: budget.income,
    fixedTotal: budget.categories.filter((c) => !c.flexible).reduce((s, c) => s + c.cap, 0),
    savings: budget.hardSavingsGoal,
    planReserved: othersReserved + num(monthly),
    flexibleCaps: budget.categories.filter((c) => c.flexible).reduce((s, c) => s + c.cap, 0),
  });

  async function submit() {
    setBusy(true);
    setLocalError(null);
    const body = {
      name: name.trim(),
      targetAmount: num(target),
      monthlySetAside: num(monthly),
      targetDate: deadline || null,
    };
    const res = await fetch("/api/plans", {
      method: plan ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(plan ? { id: plan.id, ...body } : body),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setLocalError(data.error ?? "That didn't save.");
      return;
    }
    if (plan) onChanged(null);
    onClose();
  }

  async function patch(payload: Record<string, unknown>) {
    if (!plan) return;
    setBusy(true);
    setLocalError(null);
    const res = await fetch("/api/plans", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: plan.id, ...payload }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setLocalError(data.error ?? "That didn't save.");
      return;
    }
    const data = await res.json();
    onChanged(data.plans ?? null);
    onClose();
  }

  async function remove() {
    if (!plan) return;
    setBusy(true);
    const res = await fetch(`/api/plans?id=${plan.id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) return setLocalError("That didn't delete.");
    const data = await res.json();
    onChanged(data.plans ?? null);
    onClose();
  }

  return (
    <div className="sheet-scrim" onClick={onClose}>
      <div className="sheet-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Plan">
        <div className="flex items-center gap-3">
          <span
            className="inline-flex h-9 w-9 items-center justify-center rounded-full"
            style={{ background: "var(--paper-2)", color: "var(--ink-2)" }}
          >
            <TargetIcon size={17} />
          </span>
          <h3 className="text-[17px] font-bold">{plan ? plan.name : "New plan"}</h3>
        </div>

        <div className="mt-5 space-y-4">
          <Field label="What is it?">
            <input
              className="field"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Laptop"
              aria-label="Plan name"
            />
          </Field>

          <Field label="What does it cost?">
            <input
              inputMode="decimal"
              className="field num"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="45000"
              aria-label="Target amount"
            />
          </Field>

          <Field label="Set aside each month">
            <input
              inputMode="decimal"
              className="field num"
              value={monthly}
              onChange={(e) => setMonthly(e.target.value)}
              placeholder="1500"
              aria-label="Monthly set-aside"
            />
          </Field>

          <Field label="Wanted by">
            <input
              type="date"
              className="field num"
              value={deadline}
              min={dayKey()}
              onChange={(e) => setDeadline(e.target.value)}
              aria-label="Target date"
            />
          </Field>
        </div>

        {num(monthly) > 0 && (
          <p className={`mt-4 text-[13.5px] leading-relaxed ${status.ok ? "text-[var(--ink-2)]" : "warn-text"}`}>
            {status.ok ? (
              <>
                Fits. Categories keep {pesoShort(status.flexiblePool)} a month to divide among
                themselves.
              </>
            ) : (
              <>
                {peso(status.over)} short. Set aside less, or free it from a category in Setup first.
              </>
            )}
          </p>
        )}

        {plan && (
          <>
            <div className="mt-5 flex gap-2">
              <input
                inputMode="decimal"
                className="field num"
                value={contribution}
                onChange={(e) => setContribution(e.target.value)}
                placeholder="Add ₱ toward it"
                aria-label="Contribution"
              />
              <button
                className="btn-ghost shrink-0 px-5 text-sm"
                disabled={!num(contribution) || busy}
                onClick={() => patch({ addToSaved: num(contribution) })}
              >
                Put in
              </button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button className="chip" disabled={busy} onClick={() => patch({ status: plan.status === "paused" ? "active" : "paused" })}>
                <span className="inline-flex items-center gap-1.5">
                  <ClockIcon size={13} />
                  {plan.status === "paused" ? "Resume" : "Pause"}
                </span>
              </button>
              <button className="chip" disabled={busy} onClick={() => patch({ status: "done" })}>
                <span className="inline-flex items-center gap-1.5">
                  <CheckIcon size={13} />
                  Mark funded
                </span>
              </button>
              <button className="chip" disabled={busy} onClick={remove}>
                <span className="inline-flex items-center gap-1.5" style={{ color: "var(--ink-2)" }}>
                  <TrashIcon size={13} />
                  Delete
                </span>
              </button>
            </div>
            {plan.targetDate && (
              <p className="micro mt-3 inline-flex items-center gap-1.5">
                <CalendarIcon size={12} />
                Needs {peso(plan.projection.requiredMonthly ?? 0)} a month to make {monthYear(plan.targetDate)}
              </p>
            )}
          </>
        )}

        {localError && <p className="warn-text mt-3 text-[14px]">{localError}</p>}

        <button
          className="btn-primary mt-5 w-full"
          onClick={submit}
          disabled={busy || !name.trim() || num(target) <= 0 || !status.ok}
        >
          {busy ? "Saving…" : plan ? "Save changes" : "Create plan"}
        </button>
        <button className="btn-ghost mt-2.5 w-full" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="micro mb-1.5 block">{label}</span>
      {children}
    </label>
  );
}
