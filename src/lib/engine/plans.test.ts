import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addMonths,
  allocationStatus,
  budgetPool,
  coverShortfall,
  monthsBetween,
  planProjection,
  reserveTotal,
  type PlanLike,
} from "./plans";

const plan = (over: Partial<PlanLike> = {}): PlanLike => ({
  id: "p1",
  name: "Laptop",
  targetAmount: 45000,
  savedAmount: 0,
  monthlySetAside: 2500,
  targetDate: null,
  createdAt: new Date(2026, 0, 15),
  status: "active",
  ...over,
});

// ── Calendar helpers ──────────────────────────────────────────────────────

test("monthsBetween: whole calendar months only", () => {
  assert.equal(monthsBetween(new Date(2026, 0, 15), new Date(2026, 0, 20)), 0);
  assert.equal(monthsBetween(new Date(2026, 0, 15), new Date(2026, 1, 15)), 1);
  assert.equal(monthsBetween(new Date(2026, 0, 15), new Date(2026, 1, 14)), 0);
  assert.equal(monthsBetween(new Date(2026, 0, 15), new Date(2027, 0, 15)), 12);
});

test("monthsBetween: never negative and never NaN for reversed ranges", () => {
  assert.equal(monthsBetween(new Date(2026, 5, 1), new Date(2025, 0, 1)), 0);
});

test("addMonths: clamps to the last day of short months", () => {
  assert.equal(addMonths(new Date(2026, 0, 31), 1).getMonth(), 1);
  assert.equal(addMonths(new Date(2026, 0, 31), 1).getDate(), 28);
  assert.equal(addMonths(new Date(2026, 2, 15), 1).getDate(), 15);
});

// ── Projections ───────────────────────────────────────────────────────────

test("plan: no set-aside means no projection, not a divide-by-zero", () => {
  const proj = planProjection(plan({ monthlySetAside: 0 }), new Date(2026, 0, 15));
  assert.equal(proj.monthsToTarget, null);
  assert.equal(proj.projectedDate, null);
  assert.equal(proj.onTrack, null);
  assert.equal(proj.remaining, 45000);
});

test("plan: accrues the set-aside for every whole month since it started", () => {
  const at = new Date(2026, 3, 15); // 3 whole months after Jan 15
  const proj = planProjection(plan(), at);
  assert.equal(proj.saved, 7500);
  assert.equal(proj.remaining, 37500);
  assert.equal(proj.monthsToTarget, 15); // ceil(37500 / 2500)
});

test("plan: manual savings count toward progress alongside the accrual", () => {
  const proj = planProjection(plan({ savedAmount: 10000 }), new Date(2026, 1, 15));
  assert.equal(proj.saved, 12500);
  assert.equal(proj.remaining, 32500);
});

test("plan: progress can never exceed the target", () => {
  const proj = planProjection(
    plan({ savedAmount: 44000, targetAmount: 45000 }),
    new Date(2026, 5, 15)
  );
  assert.equal(proj.saved, 45000);
  assert.equal(proj.remaining, 0);
  assert.equal(proj.pct, 1);
  assert.equal(proj.finished, true);
  assert.equal(proj.monthsToTarget, 0);
});

test("plan: a paused plan stops accruing and stops reserving money", () => {
  const proj = planProjection(plan({ savedAmount: 5000, status: "paused" }), new Date(2026, 3, 15));
  assert.equal(proj.saved, 5000);
  assert.equal(proj.paused, true);
  assert.equal(proj.monthsToTarget, null);
});

test("plan: deadline decides whether it is on track", () => {
  const at = new Date(2026, 0, 15);
  // 37500 remaining at 2500/mo = 15 months → lands Feb 2027.
  const late = planProjection(plan({ targetDate: new Date(2026, 5, 30) }), at);
  assert.equal(late.onTrack, false);
  assert.ok(late.requiredMonthly! > late.monthsToTarget!);
  // Give it a deadline it can comfortably hit.
  const fine = planProjection(plan({ targetDate: new Date(2029, 0, 1) }), at);
  assert.equal(fine.onTrack, true);
});

test("plan: projected date is exact, not optimistic", () => {
  const proj = planProjection(plan({ targetAmount: 5000, monthlySetAside: 2500 }), new Date(2026, 0, 15));
  assert.equal(proj.monthsToTarget, 2);
  assert.equal(proj.projectedDate?.getMonth(), 2); // March
  assert.equal(proj.projectedDate?.getDate(), 15);
});

// ── Reserve + pool ────────────────────────────────────────────────────────

test("reserve: only active plans reserve money", () => {
  const total = reserveTotal([
    plan({ id: "a", monthlySetAside: 2000 }),
    plan({ id: "b", monthlySetAside: 1000, status: "paused" }),
    plan({ id: "c", monthlySetAside: 500, status: "done" }),
  ]);
  assert.equal(total, 2000);
});

test("pool: income minus fixed minus savings, never negative", () => {
  assert.equal(budgetPool({ income: 25000, fixedTotal: 14500, savings: 3000 }), 7500);
  assert.equal(budgetPool({ income: 1000, fixedTotal: 5000, savings: 0 }), 0);
});

test("allocation: plans shrink the space categories may divide", () => {
  const status = allocationStatus({
    income: 25000,
    fixedTotal: 14500,
    savings: 3000,
    planReserved: 1500,
    flexibleCaps: 6000,
  });
  assert.equal(status.pool, 7500);
  assert.equal(status.flexiblePool, 6000);
  assert.equal(status.over, 0);
  assert.equal(status.unallocated, 0);
  assert.equal(status.ok, true);
});

test("allocation: over-allocating is blocked, never silently absorbed", () => {
  const status = allocationStatus({
    income: 25000,
    fixedTotal: 14500,
    savings: 3000,
    planReserved: 0,
    flexibleCaps: 8000,
  });
  assert.equal(status.over, 500);
  assert.equal(status.ok, false);
  assert.equal(status.unallocated, 0);
});

test("allocation: allocating less leaves quiet savings, not spendable slack", () => {
  const status = allocationStatus({
    income: 25000,
    fixedTotal: 14500,
    savings: 3000,
    planReserved: 0,
    flexibleCaps: 5000,
  });
  assert.equal(status.unallocated, 2500);
  assert.equal(status.ok, true);
});

test("allocation: floating-point dust does not block a save", () => {
  const status = allocationStatus({
    income: 100,
    fixedTotal: 0.1,
    savings: 0.2,
    planReserved: 0,
    flexibleCaps: 99.7,
  });
  assert.equal(status.ok, true);
});

// ── Auto-balance ──────────────────────────────────────────────────────────

test("coverShortfall: pulls proportionally so the budget keeps its shape", () => {
  const moves = coverShortfall(
    [
      { id: "food", name: "Food", cap: 3000 },
      { id: "transport", name: "Transport", cap: 1200 },
      { id: "fun", name: "Fun", cap: 600 },
    ],
    480
  );
  const total = moves.reduce((s, m) => s + m.amount, 0);
  assert.equal(Math.round(total * 100) / 100, 480);
  const food = moves.find((m) => m.id === "food")!;
  const fun = moves.find((m) => m.id === "fun")!;
  assert.ok(food.amount > fun.amount);
});

test("coverShortfall: never takes more than a category holds", () => {
  const moves = coverShortfall(
    [
      { id: "food", name: "Food", cap: 3000 },
      { id: "fun", name: "Fun", cap: 30 },
    ],
    100
  );
  const fun = moves.find((m) => m.id === "fun")!;
  assert.ok(fun.amount <= 30);
  assert.equal(Math.round(moves.reduce((s, m) => s + m.amount, 0) * 100) / 100, 100);
});

test("coverShortfall: reports what it cannot cover by returning less", () => {
  const moves = coverShortfall([{ id: "fun", name: "Fun", cap: 50 }], 200);
  assert.equal(Math.round(moves.reduce((s, m) => s + m.amount, 0) * 100) / 100, 50);
});

test("coverShortfall: no donors and no shortfall are both harmless", () => {
  assert.deepEqual(coverShortfall([], 500), []);
  assert.deepEqual(coverShortfall([{ id: "a", name: "A", cap: 100 }], 0), []);
});
