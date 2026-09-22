"use client";

import { useMemo, useState } from "react";
import {
  applyTradeOff,
  calculateSafeToSpend,
  computeTradeOff,
  remaining,
  type BudgetState,
  type Category,
} from "@/lib/engine/budget";

/**
 * The zero-sum mechanic, running live on the visitor's own categories.
 *
 * It imports the same engine the chat route uses. Nothing here is a mock or a
 * re-implementation, so whatever the tutorial shows is exactly what will happen
 * when the money is real.
 */
export function TradeOffSandbox({
  categories,
  income,
  hardSavingsGoal,
  spentToday,
}: {
  categories: Category[];
  income: number;
  hardSavingsGoal: number;
  spentToday: number;
}) {
  const base = useMemo(
    () =>
      categories
        .filter((c) => c.flexible)
        .map((c) => ({ id: c.id, name: c.name, monthlyCap: c.monthlyCap, spent: c.spent, flexible: true })),
    [categories]
  );

  // Fixed costs must stay in the state handed to the engine: without them the
  // pool looks far bigger than it is and the safe-to-spend figure lies.
  const fixed = useMemo(
    () => categories.filter((c) => !c.flexible).map((c) => ({ ...c, flexible: false })),
    [categories]
  );

  const [extra, setExtra] = useState<Record<string, number>>({});

  const result = useMemo(() => {
    let working: Category[] = base.map((c) => ({ ...c }));
    const moves: { from: string; to: string; amount: number }[] = [];
    let partial = false;

    const touched = base
      .filter((c) => (extra[c.id] ?? 0) > 0)
      .sort((a, b) => (extra[b.id] ?? 0) - (extra[a.id] ?? 0));

    for (const c of touched) {
      const amount = extra[c.id];
      const live = working.find((w) => w.id === c.id) ?? c;
      const plan = computeTradeOff(working, c.id, amount);
      if (plan.overshoot > 0) {
        const state: BudgetState = {
          income,
          hardSavingsGoal,
          categories: working,
          spentToday: 0,
          committedPending: 0,
        };
        working = applyTradeOff(state, c.id, amount, plan).categories;
        moves.push(
          ...plan.moves.map((m) => ({
            from: working.find((w) => w.id === m.fromCategoryId)?.name ?? "another category",
            to: live.name,
            amount: m.amount,
          }))
        );
        if (plan.partial) partial = true;
      } else {
        working = working.map((w) => (w.id === c.id ? { ...w, spent: w.spent + amount } : w));
      }
    }

    const totalExtra = Object.values(extra).reduce((s, v) => s + v, 0);
    const at = new Date();
    const stsBefore = calculateSafeToSpend(
      { income, hardSavingsGoal, categories: [...fixed, ...base], spentToday, committedPending: 0 },
      at
    );
    const stsAfter = calculateSafeToSpend(
      {
        income,
        hardSavingsGoal,
        categories: [...fixed, ...working],
        spentToday: spentToday + totalExtra,
        committedPending: 0,
      },
      at
    );

    return { working, moves, partial, totalExtra, stsBefore, stsAfter, over: moves.reduce((s, m) => s + m.amount, 0) };
  }, [base, fixed, extra, income, hardSavingsGoal, spentToday]);

  const peso = (n: number) =>
    `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  if (base.length === 0) {
    return (
      <p className="micro">
        Add a flexible category in Setup and this sandbox will use your real numbers.
      </p>
    );
  }

  return (
    <div>
      <p className="sub text-[14px] leading-relaxed">
        Drag a category past its limit. These are your real caps and your real month-to-date spending.
      </p>

      <div className="mt-4 space-y-4">
        {base.map((c, i) => {
          const value = extra[c.id] ?? 0;
          const live = result.working.find((w) => w.id === c.id) ?? c;
          const capNow = live.monthlyCap;
          const spentNow = live.spent;
          const room = remaining(c);
          const overNow = spentNow > capNow + 0.005;
          return (
            <div key={c.id}>
              <div className="flex items-baseline gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: `var(--seg-${(i % 6) + 1})` }} />
                <span className="text-[15px] font-medium">{c.name}</span>
                <span className="micro num ml-auto">
                  {peso(spentNow)} of {peso(capNow)}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={Math.max(100, Math.ceil(room / 100) * 100)}
                step={50}
                value={value}
                onChange={(e) => setExtra({ ...extra, [c.id]: Number(e.target.value) })}
                style={{ width: "100%", accentColor: overNow ? "var(--warn)" : "var(--accent)", marginTop: 8 }}
                aria-label={`Extra spend on ${c.name}`}
              />
              <p className="micro num mt-1">
                {value > 0 ? `+${peso(value)} today` : `\u00A0`}
                {overNow ? ` · ${peso(spentNow - capNow)} past the limit` : ""}
              </p>
            </div>
          );
        })}
      </div>

      <div className="mt-5 border-t pt-4" style={{ borderColor: "var(--hairline)" }}>
        {result.moves.length === 0 ? (
          <p className="sub text-[14px] leading-relaxed">
            Nothing over its limit yet. The moment something is, the others give up their room for it.
          </p>
        ) : (
          <>
            {result.moves.map((m, i) => (
              <p key={i} className="num text-[14px] leading-relaxed">
                {m.to} <span style={{ color: "var(--ink-3)" }}>takes</span> {peso(m.amount)}{" "}
                <span style={{ color: "var(--ink-3)" }}>from</span> {m.from}
              </p>
            ))}
            <p className="micro mt-2.5 leading-relaxed">
              {peso(result.over)} moved. No limit was raised to cover it, and your savings floor of{" "}
              {peso(hardSavingsGoal)} never entered the conversation.
              {result.partial ? " Part of it couldn't be absorbed, so that comes out of the days ahead." : ""}
            </p>
          </>
        )}

        <div className="mt-4 flex items-baseline justify-between">
          <span className="micro">Safe-to-Spend today</span>
          <span className="num text-[15px] font-semibold">
            {peso(result.stsBefore)}
            {result.totalExtra > 0 && (
              <>
                <span style={{ color: "var(--ink-3)" }}> → </span>
                {peso(result.stsAfter)}
              </>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}
