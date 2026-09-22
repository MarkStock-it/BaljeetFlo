/**
 * Plans: the commitment layer.
 *
 * A plan reserves a fixed amount of the monthly flexible pool so the user
 * cannot spend it on impulse. It never creates money: reserving ₱2,000 for a
 * laptop means ₱2,000 fewer pesos inside the flexible categories. The budget
 * editor enforces that identity, and this module is the arithmetic everyone
 * agrees on (route validation, UI, chat, tests).
 *
 * Pure functions only. No dates from the outside world except the ones passed in.
 */

export type PlanLike = {
  id: string;
  name: string;
  targetAmount: number;
  savedAmount: number;
  monthlySetAside: number;
  targetDate: Date | null;
  createdAt: Date;
  status: "active" | "done" | "paused";
};

export type PlanProjection = {
  /** Progress including automatic monthly accrual. */
  saved: number;
  remaining: number;
  /** 0..1 progress toward the target. */
  pct: number;
  /** Months of set-aside still needed. null when paused with no rate. */
  monthsToTarget: number | null;
  projectedDate: Date | null;
  /** Compared against targetDate. null when the plan has no deadline. */
  onTrack: boolean | null;
  /** Monthly amount needed to still hit the deadline. null when no deadline. */
  requiredMonthly: number | null;
  finished: boolean;
  paused: boolean;
};

export type BudgetSplit = {
  income: number;
  fixedTotal: number;
  savings: number;
  planReserved: number;
  flexibleCaps: number;
};

export type AllocationStatus = {
  /** income − fixed costs − savings. Everything the user may spend. */
  pool: number;
  /** pool − what plans have reserved. What categories may divide among themselves. */
  flexiblePool: number;
  allocated: number;
  /** Pesos allocated past the pool. Anything above zero blocks a save. */
  over: number;
  /** Pesos left inside the pool that no category claims. It just never gets spent. */
  unallocated: number;
  ok: boolean;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export function addMonths(d: Date, n: number): Date {
  const out = new Date(d.getTime());
  const day = out.getDate();
  out.setDate(1);
  out.setMonth(out.getMonth() + n);
  const lastDay = new Date(out.getFullYear(), out.getMonth() + 1, 0).getDate();
  out.setDate(Math.min(day, lastDay));
  return out;
}

/** Whole calendar months between two dates. Never negative. */
export function monthsBetween(from: Date, to: Date): number {
  if (!(to > from)) return 0;
  let months =
    (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  if (to.getDate() < from.getDate()) months -= 1;
  return Math.max(0, months);
}

/**
 * Where a plan stands today. Progress accrues at the set-aside rate for every
 * whole month the plan has been running, so the user never has to log anything.
 */
export function planProjection(p: PlanLike, now: Date = new Date()): PlanProjection {
  const target = Math.max(0, p.targetAmount);
  const paused = p.status === "paused";
  const rate = paused ? 0 : Math.max(0, p.monthlySetAside);
  const accrued = rate * monthsBetween(p.createdAt, now);
  const saved = Math.min(target, Math.max(0, p.savedAmount) + accrued);
  const remaining = Math.max(0, round2(target - saved));
  const pct = target <= 0 ? 1 : Math.min(1, saved / target);
  const finished = p.status === "done" || remaining <= 0.005;

  const monthsToTarget = finished ? 0 : rate > 0 ? Math.ceil(remaining / rate) : null;
  const projectedDate = monthsToTarget === null ? null : addMonths(now, monthsToTarget);

  const deadline = p.targetDate ? new Date(p.targetDate) : null;
  const requiredMonthly =
    finished || !deadline
      ? finished
        ? 0
        : null
      : round2(remaining / Math.max(1, monthsBetween(now, deadline)));

  const onTrack = finished ? true : deadline && projectedDate ? projectedDate <= deadline : null;

  return {
    saved: round2(saved),
    remaining,
    pct,
    monthsToTarget,
    projectedDate,
    onTrack,
    requiredMonthly,
    finished,
    paused,
  };
}

/** Total a month's plans reserve out of the flexible pool. */
export function reserveTotal(plans: Pick<PlanLike, "monthlySetAside" | "status">[]): number {
  return round2(
    plans
      .filter((p) => p.status === "active")
      .reduce((s, p) => s + Math.max(0, p.monthlySetAside), 0)
  );
}

export function budgetPool(split: Pick<BudgetSplit, "income" | "fixedTotal" | "savings">): number {
  return Math.max(0, round2(split.income - split.fixedTotal - split.savings));
}

/**
 * The one rule that keeps the app honest: you may never allocate more than you
 * earn. Allocating less is allowed and quietly becomes savings: the pacing
 * engine throttles against real liquidity, so unrouted money can't be spent.
 */
export function allocationStatus(split: BudgetSplit): AllocationStatus {
  const pool = budgetPool(split);
  const flexiblePool = Math.max(0, round2(pool - Math.max(0, split.planReserved)));
  const allocated = round2(Math.max(0, split.flexibleCaps));
  const over = Math.max(0, round2(allocated - flexiblePool));
  const unallocated = Math.max(0, round2(flexiblePool - allocated));
  return { pool, flexiblePool, allocated, over, unallocated, ok: over <= 0.005 };
}

/**
 * "Balance it": pull a shortfall out of the categories, proportionally to
 * their size so the shape of the budget survives. Deterministic; a partial
 * result means even emptying every category wasn't enough.
 */
export function coverShortfall(
  caps: { id: string; name: string; cap: number }[],
  shortfall: number
): { id: string; amount: number }[] {
  const need = round2(shortfall);
  if (need <= 0) return [];
  const donors = caps.filter((c) => c.cap > 0.005);
  const total = donors.reduce((s, c) => s + c.cap, 0);
  if (total <= 0.005) return [];

  const out = donors.map((c) => ({
    id: c.id,
    amount: Math.min(c.cap, round2((need * c.cap) / total)),
  }));

  let left = round2(need - out.reduce((s, m) => s + m.amount, 0));
  let guard = 0;
  while (left > 0.005 && guard++ < 500) {
    const idx = donors
      .map((c, i) => ({ i, room: c.cap - out[i].amount }))
      .filter((x) => x.room > 0.005)
      .sort((a, b) => b.room - a.room)[0];
    if (!idx) break;
    const give = Math.min(idx.room, left);
    out[idx.i].amount = round2(out[idx.i].amount + give);
    left = round2(left - give);
  }

  return out.filter((m) => m.amount > 0.005);
}

/** One sentence explaining where a plan lands. Used by UI and chat alike. */
export function planSentence(p: PlanLike, proj: PlanProjection): string {
  if (proj.finished) return `${p.name} is fully funded.`;
  if (proj.paused) return `${p.name} is paused, so nothing is being set aside.`;
  if (proj.monthsToTarget === null) return `${p.name} has no monthly set-aside yet.`;
  const when = proj.projectedDate
    ? proj.projectedDate.toLocaleDateString("en-PH", { month: "long", year: "numeric" })
    : "";
  if (proj.onTrack === false && proj.requiredMonthly !== null) {
    return `${p.name} arrives ${when}, about ₱${proj.requiredMonthly.toLocaleString("en-PH")} a month short of your deadline.`;
  }
  return `${p.name} arrives around ${when}.`;
}
