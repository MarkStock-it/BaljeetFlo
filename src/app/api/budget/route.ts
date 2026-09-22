import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/requireUser";
import { getStore } from "@/lib/store";
import { buildBudgetState, fmt } from "@/lib/ai/route-helpers";
import { calculateSafeToSpend, remaining } from "@/lib/engine/budget";
import { stackValue } from "@/lib/engine/stack";
import { allocationStatus, reserveTotal, planProjection } from "@/lib/engine/plans";
import {
  committedThisMonth,
  describeSchedule,
  nextOccurrence,
} from "@/lib/engine/recurring";
import { toSchedule } from "@/lib/ai/route-helpers";
import { dayKey } from "@/lib/day";
import type { BudgetWrite } from "@/lib/store/types";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Everything the app needs to draw the hero number, the editor and the guide. */
export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const store = getStore();
  const state = await buildBudgetState(user.id);
  const sts = calculateSafeToSpend(state);

  const flexible = state.categories.filter((c) => c.flexible);
  const fixed = state.categories.filter((c) => !c.flexible);
  const flexibleTotal = flexible.reduce((s, c) => s + c.monthlyCap, 0);
  const flexibleSpent = flexible.reduce((s, c) => s + c.spent, 0);

  const plans = await store.listPlans(user.id);
  const reserved = reserveTotal(plans);

  // Money on a rhythm: what the rest of this month still owes, and when each
  // schedule next lands. Shown under the hero so the one number stays explainable.
  const now = new Date();
  const schedules = (await store.listRecurring(user.id)).filter((r) => r.active);
  const recurring = schedules.map((r) => {
    const s = toSchedule(r);
    const next = nextOccurrence(s, now);
    return {
      id: r.id,
      name: r.name,
      amount: r.amount,
      schedule: describeSchedule(s),
      nextDate: next ? dayKey(next) : null,
      committedThisMonth: committedThisMonth(s, r.amount, now),
    };
  });
  const committedUpcomingTotal = round2(recurring.reduce((s, r) => s + r.committedThisMonth, 0));

  const allocation = allocationStatus({
    income: state.income,
    fixedTotal: fixed.reduce((s, c) => s + c.monthlyCap, 0),
    savings: state.hardSavingsGoal,
    planReserved: reserved,
    flexibleCaps: flexibleTotal,
  });

  const dayStats = await store.listDayStats(user.id, 60);
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const { total: monthTx } = await store.listTransactions(user.id, {
    from: monthStart,
    page: 0,
    pageSize: 1,
  });

  return NextResponse.json({
    hasGeminiKey: Boolean(user.geminiApiKeyEnc),
    safeToSpend: sts,
    safeToSpendLabel: fmt(sts),
    spentToday: state.spentToday,
    income: state.income,
    hardSavingsGoal: state.hardSavingsGoal,
    reminderHour: user.reminderHour,
    categories: state.categories.map((c) => ({
      id: c.id,
      name: c.name,
      flexible: c.flexible,
      cap: c.monthlyCap,
      remaining: remaining(c),
      spent: c.spent,
    })),
    allocation,
    plans: plans
      .filter((p) => p.status !== "done")
      .map((p) => ({
        id: p.id,
        name: p.name,
        targetAmount: p.targetAmount,
        monthlySetAside: p.monthlySetAside,
        status: p.status,
        projection: planProjection(p),
      })),
    planReserved: reserved,
    recurring,
    recurringCommitted: committedUpcomingTotal,
    monthTransactions: monthTx,
    stack: stackValue({ flexibleTotal, flexibleSpent, dayStats }),
  });
}

/**
 * Saves the entire budget in one atomic write.
 *
 * The rule the whole product rests on: you can move money between categories,
 * but you cannot invent it. Allocating more than (income − fixed − savings −
 * plans) is rejected here, not merely discouraged in the UI.
 */
export async function POST(req: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const raw = (await req.json()) as Partial<BudgetWrite>;
  const income = num(raw.monthlyIncome);
  const savings = num(raw.hardSavingsGoal);

  if (!(income > 0)) {
    return NextResponse.json({ error: "Tell me what comes in each month first." }, { status: 400 });
  }
  if (savings < 0) {
    return NextResponse.json({ error: "A savings goal can't be negative." }, { status: 400 });
  }

  const fixed = (raw.fixed ?? [])
    .map((f) => ({ id: f.id, name: (f.name ?? "").trim(), amount: num(f.amount) }))
    .filter((f) => f.name && f.amount >= 0);
  const flexible = (raw.flexible ?? [])
    .map((c) => ({ id: c.id, name: (c.name ?? "").trim(), monthlyCap: num(c.monthlyCap) }))
    .filter((c) => c.name && c.monthlyCap >= 0);

  if (flexible.length === 0) {
    return NextResponse.json(
      { error: "Keep at least one category the trade-offs can move money between." },
      { status: 400 }
    );
  }

  const store = getStore();
  const plans = await store.listPlans(user.id);
  const reserved = reserveTotal(plans);

  const allocation = allocationStatus({
    income,
    fixedTotal: fixed.reduce((s, f) => s + f.amount, 0),
    savings,
    planReserved: reserved,
    flexibleCaps: flexible.reduce((s, c) => s + c.monthlyCap, 0),
  });

  if (!allocation.ok) {
    return NextResponse.json(
      {
        error: `${fmt(allocation.over)} more than you have. Take it from another category or from savings.`,
        over: allocation.over,
        allocation,
      },
      { status: 409 }
    );
  }

  await store.saveBudget(user.id, {
    monthlyIncome: income,
    hardSavingsGoal: savings,
    fixed,
    flexible,
  });

  return NextResponse.json({ ok: true, allocation });
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}
