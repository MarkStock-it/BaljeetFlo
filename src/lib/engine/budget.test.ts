import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calculateSafeToSpend,
  computeTradeOff,
  applyTradeOff,
  remaining,
  type BudgetState,
  type Category,
} from "./budget";
import { parseFallback } from "./parse";
import { stackValue } from "./stack";

const cat = (
  id: string,
  name: string,
  monthlyCap: number,
  spent: number,
  flexible = true
): Category => ({ id, name, monthlyCap, spent, flexible });

const baseState = (cats: Category[], over: Partial<BudgetState> = {}): BudgetState => ({
  income: 25000,
  hardSavingsGoal: 3000,
  categories: cats,
  spentToday: 0,
  committedPending: 0,
  ...over,
});

// ── Safe-to-Spend ─────────────────────────────────────────────────────────

test("STS: pools income minus fixed minus savings across days in month", () => {
  // 25000 - 14500 fixed - 3000 savings = 7500 pool
  const state = baseState([
    cat("rent", "Rent", 12000, 0, false),
    cat("bills", "Bills", 2500, 0, false),
    cat("food", "Food", 4000, 0),
    cat("fun", "Fun", 3500, 0),
  ]);
  // Feb 2026 has 28 days; day 14 → 15 days remaining incl. today
  const at = new Date(2026, 1, 14, 12, 0, 0);
  const sts = calculateSafeToSpend(state, at);
  const dailyPace = 7500 / 28;
  assert.equal(Math.round(sts * 100) / 100, Math.round(dailyPace * 15 * 100) / 100);
});

test("STS: subtracts today's spending", () => {
  const cats = [cat("food", "Food", 7500, 0)];
  const at = new Date(2026, 1, 28, 12, 0, 0);
  const clean = calculateSafeToSpend(baseState(cats), at);
  const afterSpend = calculateSafeToSpend(baseState(cats, { spentToday: 500 }), at);
  assert.equal(Math.round((clean - afterSpend) * 100) / 100, 500);
});

test("STS: never goes negative, flags via clamp at zero", () => {
  const state = baseState([cat("food", "Food", 100, 100)], { spentToday: 5000 });
  const sts = calculateSafeToSpend(state, new Date(2026, 1, 20, 12, 0, 0));
  assert.equal(sts, 0);
});

test("STS: liquidity cannot exceed flexible caps", () => {
  // Overspent flexible categories cap the liquidity even with days remaining
  const state = baseState([cat("food", "Food", 1000, 900)]);
  const at = new Date(2026, 1, 5, 12, 0, 0);
  const sts = calculateSafeToSpend(state, at);
  assert.ok(sts <= 100);
});

// ── Trade-offs ────────────────────────────────────────────────────────────

test("trade-off: no overshoot when spend fits category", () => {
  const state = baseState([cat("a", "Food", 1000, 400), cat("b", "Fun", 800, 100)]);
  const plan = computeTradeOff(state.categories, "a", 500);
  assert.equal(plan.overshoot, 0);
  assert.deepEqual(plan.moves, []);
  assert.equal(plan.partial, false);
});

test("trade-off: covers overshoot from largest-remaining donor first", () => {
  const state = baseState([
    cat("a", "Food", 1000, 800), // 200 remaining
    cat("b", "Fun", 800, 100), // 700 remaining, the largest donor
    cat("c", "Shopping", 500, 450), // 50 remaining
  ]);
  const plan = computeTradeOff(state.categories, "a", 600); // 600 - 200 = 400 over
  assert.equal(plan.overshoot, 400);
  assert.equal(plan.moves.length, 1);
  assert.equal(plan.moves[0].fromCategoryId, "b");
  assert.equal(plan.moves[0].amount, 400);
  assert.equal(plan.partial, false);
});

test("trade-off: splits across donors when the first can't cover it", () => {
  const state = baseState([
    cat("a", "Food", 1000, 900), // 100 remaining, spend 500 → 400 over
    cat("b", "Fun", 350, 250), // 100 remaining
    cat("c", "Shopping", 500, 200), // 300 remaining
  ]);
  const plan = computeTradeOff(state.categories, "a", 500);
  assert.equal(plan.overshoot, 400);
  assert.equal(plan.moves.length, 2);
  assert.equal(plan.moves[0].fromCategoryId, "c"); // 300 > 100, largest first
  assert.equal(plan.moves[0].amount, 300); // capped at availability
  assert.equal(plan.moves[1].fromCategoryId, "b");
  assert.equal(plan.moves[1].amount, 100); // remainder
  assert.equal(plan.partial, false);
});

test("trade-off: partial when donors can't cover everything", () => {
  const state = baseState([
    cat("a", "Food", 1000, 950), // 50 remaining
    cat("b", "Fun", 100, 80), // 20 remaining
  ]);
  const plan = computeTradeOff(state.categories, "a", 250); // 250 - 50 = 200 over, only 20 available
  assert.equal(plan.overshoot, 200);
  assert.equal(plan.partial, true);
  assert.equal(plan.moves[0].amount, 20);
});

test("trade-off: never pulls from fixed-cost categories", () => {
  const state = baseState([
    cat("a", "Food", 500, 450), // 50 remaining
    cat("rent", "Rent", 12000, 0, false),
  ]);
  const plan = computeTradeOff(state.categories, "a", 450); // 400 over, no flexible donors
  assert.equal(plan.overshoot, 400);
  assert.equal(plan.partial, true);
  assert.ok(plan.moves.every((m) => m.fromCategoryId !== "rent"));
});

test("applyTradeOff: reduces donor caps, adds spend to target, keeps total zero-sum", () => {
  const state = baseState([
    cat("a", "Food", 1000, 800), // 200 remaining
    cat("b", "Fun", 800, 100), // 700 remaining
  ]);
  const plan = computeTradeOff(state.categories, "a", 600); // 400 over
  const before = state.categories.filter((c) => c.flexible).reduce((s, c) => s + c.monthlyCap, 0);
  const next = applyTradeOff(state, "a", 600, plan);
  const after = next.categories.filter((c) => c.flexible).reduce((s, c) => s + c.monthlyCap, 0);
  assert.equal(before, 1800);
  // Target cap unchanged, donor cap reduced by the overshoot: zero-sum.
  assert.equal(after, 1800 - plan.overshoot);
  const target = next.categories.find((c) => c.id === "a")!;
  assert.equal(target.spent, 1400);
  const donor = next.categories.find((c) => c.id === "b")!;
  assert.equal(donor.monthlyCap, 400);
});

test("remaining: floors at zero", () => {
  assert.equal(remaining(cat("a", "Food", 100, 250)), 0);
});

// ── Fallback parser ───────────────────────────────────────────────────────

test("parser: currency symbol", () => {
  const d = parseFallback("Spent ₱140 on groceries");
  assert.equal(d?.amount, 140);
  assert.equal(d?.refund, false);
});

test("parser: bare number", () => {
  const d = parseFallback("Spent 500 on food at KFC");
  assert.equal(d?.amount, 500);
  assert.equal(d?.vendor, "KFC");
});

test("parser: refund detection", () => {
  const d = parseFallback("Got refunded 250 from Steam");
  assert.equal(d?.amount, 250);
  assert.equal(d?.refund, true);
});

test("parser: pesos suffix", () => {
  const d = parseFallback("Lunch 200 pesos");
  assert.equal(d?.amount, 200);
});

test("parser: rejects messages without amounts", () => {
  assert.equal(parseFallback("Can I afford shoes?"), null);
  assert.equal(parseFallback("hello"), null);
  assert.equal(parseFallback(""), null);
});

test("parser: rejects zero and garbage numbers", () => {
  assert.equal(parseFallback("Spent 0"), null);
});

// ── Money stack ───────────────────────────────────────────────────────────

test("stack: full when nothing spent", () => {
  const s = stackValue({ flexibleTotal: 9500, flexibleSpent: 0, dayStats: [] });
  assert.equal(s.pct, 1);
});

test("stack: shrinks with spending, floors at zero", () => {
  const half = stackValue({ flexibleTotal: 9500, flexibleSpent: 4750, dayStats: [] });
  assert.ok(Math.abs(half.pct - 0.5) < 0.001);
  const over = stackValue({ flexibleTotal: 9500, flexibleSpent: 12000, dayStats: [] });
  assert.equal(over.pct, 0);
});

test("stack: streak counts consecutive within-budget days from the most recent", () => {
  const days = [
    { day: "2026-02-18", spent: 100, stsTarget: 500, withinBudget: true },
    { day: "2026-02-17", spent: 100, stsTarget: 500, withinBudget: true },
    { day: "2026-02-16", spent: 900, stsTarget: 500, withinBudget: false },
    { day: "2026-02-15", spent: 10, stsTarget: 500, withinBudget: true },
  ];
  const s = stackValue({ flexibleTotal: 9500, flexibleSpent: 100, dayStats: days });
  assert.equal(s.streakDays, 2);
});

test("stack: zero flexible budget does not divide by zero", () => {
  const s = stackValue({ flexibleTotal: 0, flexibleSpent: 0, dayStats: [] });
  assert.equal(s.pct, 0);
});
