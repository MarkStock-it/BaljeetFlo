"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CheckIcon,
  ChevronLeftIcon,
  HomeIcon,
  IncomeIcon,
  PlusIcon,
  ShieldIcon,
  TargetIcon,
  TrashIcon,
  WalletIcon,
} from "@/components/icons";
import { AllocationMeter } from "@/components/AllocationMeter";
import { allocationStatus, budgetPool, coverShortfall } from "@/lib/engine/plans";
import { safeUuid } from "@/lib/uuid";
import { refreshBudget, useBudgetSnapshot, type BudgetSnapshot } from "@/lib/budget-snapshot";

type FixedRow = { key: string; id?: string; name: string; amount: string; spent: number };
type FlexRow = { key: string; id?: string; name: string; cap: string; spent: number };

const peso = (n: number) =>
  `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num = (s: string) => {
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

export default function BudgetEditorPage() {
  const router = useRouter();
  const snap = useBudgetSnapshot();
  const [income, setIncome] = useState("");
  const [savings, setSavings] = useState("");
  const [fixed, setFixed] = useState<FixedRow[]>([]);
  const [flex, setFlex] = useState<FlexRow[]>([]);
  const [ackFloor, setAckFloor] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  /**
   * The form is editable, so it is seeded once from the shared snapshot and
   * then owned by the user. A later background refresh of the snapshot must
   * never overwrite what they are typing.
   */
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !snap) return;
    seeded.current = true;
    seedFrom(snap);
  }, [snap]);

  function seedFrom(d: BudgetSnapshot) {
    setIncome(String(d.income));
    setSavings(String(d.hardSavingsGoal));
    setFixed(
      d.categories
        .filter((c) => !c.flexible)
        .map((c) => ({ key: c.id, id: c.id, name: c.name, amount: String(c.cap), spent: c.spent }))
    );
    setFlex(
      d.categories
        .filter((c) => c.flexible)
        .map((c) => ({ key: c.id, id: c.id, name: c.name, cap: String(c.cap), spent: c.spent }))
    );
  }

  const fixedTotal = fixed.reduce((s, f) => s + num(f.amount), 0);
  const flexTotal = flex.reduce((s, c) => s + num(c.cap), 0);
  const reserved = snap?.planReserved ?? 0;
  const pool = budgetPool({ income: num(income), fixedTotal, savings: num(savings) });

  const allocation = useMemo(
    () =>
      allocationStatus({
        income: num(income),
        fixedTotal,
        savings: num(savings),
        planReserved: reserved,
        flexibleCaps: flexTotal,
      }),
    [income, fixedTotal, savings, reserved, flexTotal]
  );

  const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
  const pace = allocation.flexiblePool / daysInMonth;
  const currentPace = snap
    ? Math.max(
        0,
        (snap.income -
          snap.categories.filter((c) => !c.flexible).reduce((s, c) => s + c.cap, 0) -
          snap.hardSavingsGoal -
          snap.planReserved) /
          daysInMonth
      )
    : pace;

  const loweringFloor = snap ? num(savings) < snap.hardSavingsGoal : false;
  const unnamedRows = fixed.some((f) => !f.name.trim()) || flex.some((c) => !c.name.trim());
  const canSave =
    !busy && num(income) > 0 && allocation.ok && !unnamedRows && (!loweringFloor || ackFloor);

  function balanceIt() {
    if (allocation.over <= 0) return;
    const donors = flex.filter((c) => num(c.cap) > 0);
    const moves = coverShortfall(
      donors.map((c) => ({ id: c.key, name: c.name, cap: num(c.cap) })),
      allocation.over
    );
    setFlex((prev) =>
      prev.map((c) => {
        const move = moves.find((m) => m.id === c.key);
        return move ? { ...c, cap: String(Math.max(0, Math.round((num(c.cap) - move.amount) * 100) / 100)) } : c;
      })
    );
    setError(null);
  }

  async function save() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/budget", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        monthlyIncome: num(income),
        hardSavingsGoal: num(savings),
        fixed: fixed.map((f) => ({ id: f.id, name: f.name.trim(), amount: num(f.amount) })),
        flexible: flex.map((c) => ({ id: c.id, name: c.name.trim(), monthlyCap: num(c.cap) })),
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "That didn't save. Try once more.");
      return;
    }
    setSaved(true);
    // The saved rules change the number everywhere, so update the shared copy
    // before the user lands back on Setup.
    void refreshBudget();
    setTimeout(() => router.push("/app/setup"), 650);
  }

  if (!snap) {
    return (
      <main className="px-5 pt-12">
        <BackLink />
        <p className="micro mt-8">Loading your budget…</p>
      </main>
    );
  }

  return (
    <main className="pb-40">
      <header className="sticky top-0 z-30 flex items-center gap-1 border-b px-3 py-3 backdrop-blur-xl"
        style={{ borderColor: "var(--hairline)", background: "var(--surface)" }}>
        <BackLink bare />
        <h1 className="text-[17px] font-bold">Your budget</h1>
      </header>

      {/* Live consequence, not a form summary */}
      <section className="px-6 pb-2 pt-6 text-center">
        <p className="text-[13px] font-medium text-[var(--ink-2)]">Spending pace</p>
        <p className="hero-num num mt-2">{peso(pace)}</p>
        <p className="micro num mt-2.5">
          a day, for {daysInMonth - new Date().getDate() + 1} more day
          {daysInMonth - new Date().getDate() + 1 === 1 ? "" : "s"}
          {Math.abs(pace - currentPace) > 0.5 ? ` · was ${peso(currentPace)}` : ""}
        </p>
      </section>

      <div className="px-5">
        {/* ── Comes in ─────────────────────────────────────────────────── */}
        <Section icon={<IncomeIcon size={16} />} title="Comes in">
          <div className="flex items-center gap-3 px-4 py-3.5">
            <span className="text-[15px]">Each month</span>
            <input
              inputMode="decimal"
              className="cap-input ml-auto"
              value={income}
              onChange={(e) => setIncome(e.target.value)}
              placeholder="0"
              aria-label="Monthly income"
            />
          </div>
        </Section>

        {/* ── Fixed costs ──────────────────────────────────────────────── */}
        <Section
          icon={<HomeIcon size={16} />}
          title="Fixed costs"
          hint="Leaves the account before anything else. Never traded away."
        >
          {fixed.map((f, i) => (
            <div key={f.key} className="flex items-center gap-3 px-4 py-3">
              <input
                className="min-w-0 flex-1 bg-transparent text-[15px] outline-none"
                style={{ fontSize: 16 }}
                value={f.name}
                placeholder="Rent"
                aria-label="Fixed cost name"
                onChange={(e) =>
                  setFixed(fixed.map((x, j) => (i === j ? { ...x, name: e.target.value } : x)))
                }
              />
              <input
                inputMode="decimal"
                className="cap-input"
                value={f.amount}
                placeholder="0"
                aria-label={`${f.name || "Fixed cost"} amount`}
                onChange={(e) =>
                  setFixed(fixed.map((x, j) => (i === j ? { ...x, amount: e.target.value } : x)))
                }
              />
              <RemoveButton onClick={() => setFixed(fixed.filter((_, j) => j !== i))} label={`Remove ${f.name || "row"}`} />
            </div>
          ))}
          <AddRow
            label="Add a fixed cost"
            onClick={() => setFixed([...fixed, { key: safeUuid(), name: "", amount: "", spent: 0 }])}
          />
        </Section>

        {/* ── Savings floor ───────────────────────────────────────────── */}
        <Section
          icon={<ShieldIcon size={16} />}
          title="Savings floor"
          hint="The point of the whole thing. It comes out first and doesn't bend when categories flex."
        >
          <div className="flex items-center gap-3 px-4 py-3.5">
            <span className="text-[15px]">Each month</span>
            <input
              inputMode="decimal"
              className="cap-input ml-auto"
              value={savings}
              onChange={(e) => {
                setSavings(e.target.value);
                setAckFloor(false);
              }}
              placeholder="0"
              aria-label="Monthly savings goal"
            />
          </div>
          {loweringFloor && (
            <button
              className="mx-4 mb-3.5 flex w-[calc(100%-2rem)] items-start gap-3 rounded-[10px] p-3.5 text-left"
              style={{ background: "color-mix(in srgb, var(--warn) 10%, transparent)" }}
              onClick={() => setAckFloor(!ackFloor)}
              aria-pressed={ackFloor}
            >
              <span
                className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border"
                style={{
                  borderColor: ackFloor ? "var(--warn)" : "var(--hairline-strong)",
                  background: ackFloor ? "var(--warn)" : "transparent",
                  color: "#fff",
                }}
              >
                {ackFloor && <CheckIcon size={12} />}
              </span>
              <span className="text-[13.5px] leading-relaxed">
                You&apos;re lowering the floor from {peso(snap.hardSavingsGoal)} to {peso(num(savings))}.
                That&apos;s allowed, since it&apos;s your money. It is still the one number this app was
                built to protect. Tap to confirm.
              </span>
            </button>
          )}
        </Section>

        {/* ── Plans ───────────────────────────────────────────────────── */}
        <Section
          icon={<TargetIcon size={16} />}
          title="Set aside for plans"
          hint="Money promised to something you want later. Reserved before categories get their cut."
        >
          <Link href="/app/plans" className="flex items-center gap-3 px-4 py-3.5">
            <span className="min-w-0 flex-1 truncate text-[15px]">
              {snap.plans.length
                ? snap.plans.map((p) => p.name).join(", ")
                : "Nothing planned yet"}
            </span>
            <span className="num text-[var(--ink-2)]">{reserved > 0 ? `−${peso(reserved)}` : "₱0.00"}</span>
          </Link>
        </Section>

        {/* ── Flexible categories ─────────────────────────────────────── */}
        <Section
          icon={<WalletIcon size={16} />}
          title="Where the rest goes"
          hint="These trade against each other. Overspend one and the others cover it."
        >
          <div className="px-4 pt-4">
            <AllocationMeter
              flex={flex.map((c) => ({ id: c.key, cap: num(c.cap) }))}
              planReserved={reserved}
              unallocated={allocation.unallocated}
            />
            <div className="mt-3 flex items-start gap-2">
              <p className={`text-[13.5px] leading-relaxed ${allocation.over > 0 ? "warn-text" : "text-[var(--ink-2)]"}`}>
                {allocation.over > 0 ? (
                  <>
                    {peso(allocation.over)} more than you have. Take it from another category, or from
                    the savings floor.
                  </>
                ) : allocation.unallocated > 0 ? (
                  <>
                    {peso(allocation.unallocated)} unassigned. It never enters a category, so it simply
                    doesn&apos;t get spent.
                  </>
                ) : (
                  <>Every peso of your spendable pool is assigned.</>
                )}
              </p>
            </div>
            {allocation.over > 0 && flex.some((c) => num(c.cap) > 0) && (
              <button className="chip mt-3" onClick={balanceIt}>
                Balance it for me
              </button>
            )}
          </div>

          {flex.map((c, i) => (
            <div key={c.key} className="flex items-center gap-3 px-4 py-3">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: `var(--seg-${(i % 6) + 1})` }} />
              <input
                className="min-w-0 flex-1 bg-transparent text-[15px] outline-none"
                style={{ fontSize: 16 }}
                value={c.name}
                placeholder="Category"
                aria-label="Category name"
                onChange={(e) =>
                  setFlex(flex.map((x, j) => (i === j ? { ...x, name: e.target.value } : x)))
                }
              />
              <input
                inputMode="decimal"
                className="cap-input"
                value={c.cap}
                placeholder="0"
                aria-label={`${c.name || "Category"} monthly cap`}
                onChange={(e) => setFlex(flex.map((x, j) => (i === j ? { ...x, cap: e.target.value } : x)))}
              />
              <RemoveButton onClick={() => setFlex(flex.filter((_, j) => j !== i))} label={`Remove ${c.name || "category"}`} />
            </div>
          ))}
          <AddRow
            label="Add a category"
            onClick={() => setFlex([...flex, { key: safeUuid(), name: "", cap: "", spent: 0 }])}
          />
          {flex.some((c) => c.spent !== 0 && !snap.categories.some((x) => x.id === c.id)) && (
            <p className="micro px-4 pb-3">
              Removing a category doesn&apos;t erase its history. Those purchases just stop counting
              toward a limit.
            </p>
          )}
        </Section>

        {/* ── The arithmetic, in the open ─────────────────────────────── */}
        <section className="figure mt-6">
          <p className="micro">The arithmetic</p>
          <div className="formula mt-2">
            <div>
              {peso(num(income))} <span className="op">in</span>
            </div>
            <div>
              − {peso(fixedTotal)} <span className="op">fixed costs</span>
            </div>
            <div>
              − {peso(num(savings))} <span className="op">savings floor</span>
            </div>
            <div style={{ borderTop: "1px solid var(--hairline)", marginTop: 4, paddingTop: 4 }}>
              {peso(pool)} <span className="op">spendable each month</span>
            </div>
            {reserved > 0 && (
              <div>
                − {peso(reserved)} <span className="op">reserved for plans</span>
              </div>
            )}
            <div>
              = {peso(allocation.flexiblePool)} <span className="op">divided across categories</span>
            </div>
          </div>
        </section>

        {error && <p className="warn-text mt-4 text-[14px]">{error}</p>}
      </div>

      {/* ── Save bar ───────────────────────────────────────────────────── */}
      <div
        className="fixed inset-x-0 z-40 mx-auto max-w-md border-t px-4 py-3 backdrop-blur-xl"
        style={{
          borderColor: "var(--hairline)",
          background: "var(--surface)",
          bottom: "calc(var(--tabbar) + env(safe-area-inset-bottom))",
        }}
      >
        <button className="btn-primary w-full" onClick={save} disabled={!canSave}>
          {saved ? "Saved" : busy ? "Saving…" : allocation.over > 0 ? "Fix the overage first" : "Save budget"}
        </button>
        {!allocation.ok && (
          <p className="micro mt-2 text-center">
            Safe-to-Spend only changes once you save.
          </p>
        )}
      </div>
    </main>
  );
}

function BackLink({ bare }: { bare?: boolean }) {
  if (bare) {
    return (
      <Link
        href="/app/setup"
        className="inline-flex h-9 w-9 items-center justify-center rounded-full"
        style={{ color: "var(--ink-2)" }}
        aria-label="Back to setup"
      >
        <ChevronLeftIcon size={20} />
      </Link>
    );
  }
  return (
    <Link href="/app/setup" className="sub inline-flex items-center gap-1">
      <ChevronLeftIcon size={16} />
      Setup
    </Link>
  );
}

function Section({
  icon,
  title,
  hint,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card-solid mt-4 overflow-hidden">
      <div className="flex items-center gap-3 px-4 pb-1 pt-4">
        <span style={{ color: "var(--ink-3)" }}>{icon}</span>
        <h2 className="text-[15px] font-semibold">{title}</h2>
      </div>
      {hint && <p className="micro px-4 pb-2 pt-1 leading-relaxed">{hint}</p>}
      <div className="rows">{children}</div>
    </section>
  );
}

function AddRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button className="flex w-full items-center gap-2 px-4 py-3 text-left" onClick={onClick}>
      <PlusIcon size={16} />
      <span className="text-[15px]" style={{ color: "var(--accent)" }}>
        {label}
      </span>
    </button>
  );
}

function RemoveButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
      style={{ color: "var(--ink-3)" }}
      onClick={onClick}
      aria-label={label}
    >
      <TrashIcon size={16} />
    </button>
  );
}
