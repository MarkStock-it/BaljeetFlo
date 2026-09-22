import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/requireUser";
import { getStore } from "@/lib/store";
import { buildBudgetState, fmt } from "@/lib/ai/route-helpers";
import { allocationStatus, reserveTotal, planProjection, planSentence } from "@/lib/engine/plans";
import { dayKey, parseDay } from "@/lib/day";
import type { PlanRow } from "@/lib/store/types";

async function loadPlans(userId: string) {
  const plans = await getStore().listPlans(userId);
  return plans.map((p) => {
    const projection = planProjection(p);
    return {
      id: p.id,
      name: p.name,
      targetAmount: p.targetAmount,
      savedAmount: p.savedAmount,
      monthlySetAside: p.monthlySetAside,
      // Day key, not a timestamp: a local-midnight Date would serialise a day early.
      targetDate: p.targetDate ? dayKey(p.targetDate) : null,
      status: p.status,
      note: p.note,
      createdAt: p.createdAt,
      projection,
      sentence: planSentence(p, projection),
    };
  });
}

export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ plans: await loadPlans(user.id) });
}

export async function POST(req: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json()) as {
    name?: string;
    targetAmount?: number;
    savedAmount?: number;
    monthlySetAside?: number;
    targetDate?: string | null;
    note?: string | null;
  };

  const name = (body.name ?? "").trim();
  const targetAmount = num(body.targetAmount);
  const monthlySetAside = Math.max(0, num(body.monthlySetAside));

  if (!name) return NextResponse.json({ error: "Give the plan a name." }, { status: 400 });
  if (targetAmount <= 0) {
    return NextResponse.json({ error: "What does it cost?" }, { status: 400 });
  }

  const guard = await canReserve(user.id, null, monthlySetAside);
  if (!guard.ok) return NextResponse.json(guard, { status: 409 });

  const plan: PlanRow = {
    id: globalThis.crypto.randomUUID(),
    userId: user.id,
    name: name.slice(0, 80),
    targetAmount,
    savedAmount: Math.max(0, num(body.savedAmount)),
    monthlySetAside,
    targetDate: body.targetDate ? parseDay(body.targetDate) : null,
    status: "active",
    note: (body.note ?? "").trim().slice(0, 280) || null,
    createdAt: new Date(),
  };
  await getStore().createPlan(plan);

  const projection = planProjection(plan);
  return NextResponse.json({
    ok: true,
    plan: { ...plan, projection, sentence: planSentence(plan, projection) },
  });
}

export async function PATCH(req: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json()) as {
    id?: string;
    name?: string;
    targetAmount?: number;
    savedAmount?: number;
    monthlySetAside?: number;
    status?: PlanRow["status"];
    targetDate?: string | null;
    note?: string | null;
    /** Adds a one-off contribution on top of the monthly accrual. */
    addToSaved?: number;
  };
  if (!body.id) return NextResponse.json({ error: "Which plan?" }, { status: 400 });

  const store = getStore();
  const plans = await store.listPlans(user.id);
  const existing = plans.find((p) => p.id === body.id);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const nextSetAside =
    body.monthlySetAside !== undefined ? Math.max(0, num(body.monthlySetAside)) : existing.monthlySetAside;
  const nextStatus = body.status ?? existing.status;

  // Only active plans reserve money, so only a change to those two fields can
  // break the zero-sum rule.
  if (nextSetAside !== existing.monthlySetAside || nextStatus !== existing.status) {
    const effective = nextStatus === "active" ? nextSetAside : 0;
    const guard = await canReserve(user.id, existing.id, effective);
    if (!guard.ok) return NextResponse.json(guard, { status: 409 });
  }

  const patch: Partial<Omit<PlanRow, "id" | "userId">> = {};
  if (body.name !== undefined) patch.name = body.name.trim().slice(0, 80);
  if (body.targetAmount !== undefined) patch.targetAmount = Math.max(0, num(body.targetAmount));
  if (body.monthlySetAside !== undefined) patch.monthlySetAside = nextSetAside;
  if (body.status !== undefined) patch.status = body.status;
  if (body.note !== undefined) patch.note = (body.note ?? "").trim().slice(0, 280) || null;
  if (body.targetDate !== undefined) {
    patch.targetDate = body.targetDate ? parseDay(body.targetDate) : null;
  }
  if (body.savedAmount !== undefined) {
    patch.savedAmount = Math.max(0, num(body.savedAmount));
  }
  if (body.addToSaved !== undefined) {
    const add = Math.max(0, num(body.addToSaved));
    patch.savedAmount = Math.min(
      patch.targetAmount ?? existing.targetAmount,
      (patch.savedAmount ?? existing.savedAmount) + add
    );
  }

  await store.updatePlan(existing.id, patch);
  return NextResponse.json({ ok: true, plans: await loadPlans(user.id) });
}

export async function DELETE(req: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Which plan?" }, { status: 400 });

  const store = getStore();
  const plans = await store.listPlans(user.id);
  if (!plans.some((p) => p.id === id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  await store.deletePlan(id);
  return NextResponse.json({ ok: true, plans: await loadPlans(user.id) });
}

/**
 * A plan's set-aside has to come out of the same pool the categories divide.
 * If it doesn't fit, the answer names the exact shortfall instead of silently
 * squeezing the budget.
 */
async function canReserve(
  userId: string,
  excludePlanId: string | null,
  setAside: number
): Promise<{ ok: true } | { ok: false; error: string; over: number; flexiblePool: number }> {
  const store = getStore();
  const [state, plans] = await Promise.all([buildBudgetState(userId), store.listPlans(userId)]);
  const others = plans.filter((p) => p.id !== excludePlanId);
  const allocated = state.categories.filter((c) => c.flexible).reduce((s, c) => s + c.monthlyCap, 0);
  const status = allocationStatus({
    income: state.income,
    fixedTotal: state.categories.filter((c) => !c.flexible).reduce((s, c) => s + c.monthlyCap, 0),
    savings: state.hardSavingsGoal,
    planReserved: reserveTotal(others) + setAside,
    flexibleCaps: allocated,
  });
  if (status.ok) return { ok: true };
  return {
    ok: false,
    error: `${fmt(status.over)} short. Set aside less, or free that money from a category first.`,
    over: status.over,
    flexiblePool: status.flexiblePool,
  };
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}
