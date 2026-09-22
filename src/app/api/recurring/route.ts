import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/requireUser";
import { getStore } from "@/lib/store";
import { buildBudgetState, fmt, pendingPosts, toSchedule } from "@/lib/ai/route-helpers";
import {
  committedThisMonth,
  describeSchedule,
  monthlyEstimate,
  remainingThisMonth,
  nextOccurrence,
  scheduleSentence,
  startOfDay,
  unique,
} from "@/lib/engine/recurring";
import { calculateSafeToSpend } from "@/lib/engine/budget";
import { dayKey, parseDay } from "@/lib/day";
import type { RecurringRow } from "@/lib/store/types";
import { safeUuid } from "@/lib/uuid";

/** Everything a row needs to explain itself without a second request. */
async function listFor(userId: string) {
  const store = getStore();
  const [rows, cats] = await Promise.all([store.listRecurring(userId), store.getCategories(userId)]);
  const now = new Date();
  const nameOf = new Map(cats.map((c) => [c.id, c.name]));

  return rows.map((r) => {
    const s = toSchedule(r);
    const committed = committedThisMonth(s, r.amount, now);
    const next = nextOccurrence(s, now);
    return {
      id: r.id,
      name: r.name,
      amount: r.amount,
      categoryId: r.categoryId,
      categoryName: r.categoryId ? (nameOf.get(r.categoryId) ?? null) : null,
      cadence: r.cadence,
      weekdays: r.weekdays,
      dayOfMonth: r.dayOfMonth,
      startDate: dayKey(r.startDate),
      endDate: r.endDate ? dayKey(r.endDate) : null,
      active: r.active,
      lastPostedOn: r.lastPostedOn ? dayKey(r.lastPostedOn) : null,
      schedule: describeSchedule(s),
      sentence: scheduleSentence(s, now),
      nextDate: next ? dayKey(next) : null,
      occurrencesLeft: remainingThisMonth(s, now).length,
      committedThisMonth: committed,
      monthlyEstimate: monthlyEstimate(s, r.amount),
    };
  });
}

export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await listFor(user.id);
  return NextResponse.json({
    recurring: rows,
    activeCount: rows.filter((r) => r.active).length,
    committedThisMonth: round2(
      rows.filter((r) => r.active).reduce((s, r) => s + r.committedThisMonth, 0)
    ),
    monthlyEstimate: round2(
      rows.filter((r) => r.active).reduce((s, r) => s + r.monthlyEstimate, 0)
    ),
  });
}

export async function POST(req: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json()) as {
    action?: "create" | "run" | "skip";
    // create
    name?: string;
    amount?: number;
    categoryId?: string | null;
    cadence?: RecurringRow["cadence"];
    weekdays?: number[];
    dayOfMonth?: number | null;
    startDate?: string;
    endDate?: string | null;
    note?: string | null;
    // skip
    id?: string;
    day?: string;
  };

  const action = body.action ?? "create";
  if (action === "run") return runCatchUp(user.id);
  if (action === "skip") return skipOccurrence(user.id, body.id, body.day);
  return create(user.id, body);
}

export async function PATCH(req: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json()) as {
    id?: string;
    name?: string;
    amount?: number;
    categoryId?: string | null;
    cadence?: RecurringRow["cadence"];
    weekdays?: number[];
    dayOfMonth?: number | null;
    startDate?: string;
    endDate?: string | null;
    active?: boolean;
    note?: string | null;
  };
  if (!body.id) return NextResponse.json({ error: "Which schedule?" }, { status: 400 });

  const store = getStore();
  const existing = (await store.listRecurring(user.id)).find((r) => r.id === body.id);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const cadence = body.cadence ?? existing.cadence;
  const weekdays = body.weekdays ?? existing.weekdays;
  const dayOfMonth = body.dayOfMonth !== undefined ? body.dayOfMonth : existing.dayOfMonth;
  if (cadence === "weekly" && weekdays.length === 0) {
    return NextResponse.json({ error: "Pick at least one day of the week." }, { status: 400 });
  }
  if (cadence === "monthly" && (!dayOfMonth || dayOfMonth < 1 || dayOfMonth > 31)) {
    return NextResponse.json({ error: "Pick a day of the month between 1 and 31." }, { status: 400 });
  }

  const patch: Partial<Omit<RecurringRow, "id" | "userId">> = { cadence, weekdays, dayOfMonth };
  if (body.name !== undefined) patch.name = body.name.trim().slice(0, 80);
  if (body.amount !== undefined) patch.amount = round2(Math.max(0, num(body.amount)));
  if (body.categoryId !== undefined) patch.categoryId = body.categoryId;
  if (body.active !== undefined) patch.active = body.active;
  if (body.note !== undefined) patch.note = (body.note ?? "").trim().slice(0, 280) || null;
  if (body.startDate !== undefined) patch.startDate = parseDay(body.startDate) ?? existing.startDate;
  if (body.endDate !== undefined) patch.endDate = body.endDate ? parseDay(body.endDate) : null;

  await store.updateRecurring(existing.id, patch);
  return NextResponse.json({ ok: true, recurring: await listFor(user.id) });
}

export async function DELETE(req: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Which schedule?" }, { status: 400 });

  const store = getStore();
  const rows = await store.listRecurring(user.id);
  if (!rows.some((r) => r.id === id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  // Only the schedule is removed. Anything it already posted stays in the
  // ledger. Deleting history is a separate, deliberate act.
  await store.deleteRecurring(id);
  return NextResponse.json({ ok: true, recurring: await listFor(user.id) });
}

// ── creation ────────────────────────────────────────────────────────────────

async function create(
  userId: string,
  body: {
    name?: string;
    amount?: number;
    categoryId?: string | null;
    cadence?: RecurringRow["cadence"];
    weekdays?: number[];
    dayOfMonth?: number | null;
    startDate?: string;
    endDate?: string | null;
    note?: string | null;
  }
) {
  const store = getStore();
  const name = (body.name ?? "").trim();
  const amount = round2(num(body.amount));
  const cadence = body.cadence ?? "weekly";
  const weekdays = unique(
    (body.weekdays ?? []).map((n) => Number(n)).filter((n) => n >= 0 && n <= 6)
  ).sort((a, b) => a - b);
  const dayOfMonth = body.dayOfMonth ? Math.min(31, Math.max(1, Math.round(Number(body.dayOfMonth)))) : null;

  if (!name) return NextResponse.json({ error: "What is this payment for?" }, { status: 400 });
  if (amount <= 0) return NextResponse.json({ error: "How much each time?" }, { status: 400 });
  if (cadence === "weekly" && weekdays.length === 0) {
    return NextResponse.json({ error: "Pick at least one day of the week." }, { status: 400 });
  }
  if (cadence === "monthly" && !dayOfMonth) {
    return NextResponse.json({ error: "Pick a day of the month between 1 and 31." }, { status: 400 });
  }

  // Charges land in a flexible category: fixed costs already leave before
  // anything else, so posting into one would double-count them.
  const cats = await store.getCategories(userId);
  const category = cats.find((c) => c.id === body.categoryId);
  if (!category || !category.flexible) {
    return NextResponse.json(
      { error: "Choose one of your flexible categories. Fixed costs are already accounted for." },
      { status: 400 }
    );
  }

  const startDate = parseDay(body.startDate ?? "") ?? startOfDay(new Date());
  const row: RecurringRow = {
    id: safeUuid(),
    userId,
    name: name.slice(0, 80),
    categoryId: category.id,
    amount,
    cadence,
    weekdays: cadence === "weekly" ? weekdays : [],
    dayOfMonth: cadence === "monthly" ? dayOfMonth : null,
    startDate,
    endDate: body.endDate ? parseDay(body.endDate) : null,
    active: true,
    lastPostedOn: null,
    note: (body.note ?? "").trim().slice(0, 280) || null,
    createdAt: new Date(),
  };
  await store.createRecurring(row);

  // Don't make the user wait for the next visit to see today's charge.
  const posted = await postDue(userId, [row]);
  return NextResponse.json({
    ok: true,
    posted,
    recurring: await listFor(userId),
  });
}

// ── catch-up posting ────────────────────────────────────────────────────────

/**
 * Posts everything that should already be in the ledger. Called when the app
 * opens, in place of the cron the V1 stack doesn't have. Idempotent: the
 * schedule's `lastPostedOn` is the only state, so a second call in the same
 * minute posts nothing.
 */
async function runCatchUp(userId: string) {
  const store = getStore();
  const rows = (await store.listRecurring(userId)).filter((r) => r.active);
  const posted = await postDue(userId, rows);
  return NextResponse.json({
    ok: true,
    posted,
    recurring: posted.length ? await listFor(userId) : undefined,
  });
}

async function postDue(userId: string, rows: RecurringRow[]) {
  const store = getStore();
  const now = new Date();
  const due = pendingPosts(rows, now);
  if (due.length === 0) return [] as PostedOccurrence[];

  const results: PostedOccurrence[] = [];
  for (const { row, due: days } of due) {
    const total = round2(days.length * row.amount);
    // The day's target is the number *before* anything the scheduler posts, so
    // the streak measures the whole day against the same bar.
    const openingState = await buildBudgetState(userId);
    const openingTarget = calculateSafeToSpend(openingState, now);

    // One row per occurrence, timed at midday so the day it belongs to never
    // drifts across a timezone boundary.
    for (const day of days) {
      const state = await buildBudgetState(userId);
      const before = calculateSafeToSpend(state, now);
      await store.addTransaction({
        id: safeUuid(),
        userId,
        categoryId: row.categoryId,
        amount: row.amount,
        vendor: row.name,
        note: days.length > 1 ? `${row.name} (scheduled catch-up)` : `${row.name} (scheduled)`,
        source: "scheduled",
        rawInput: null,
        recurringId: row.id,
        spentAt: new Date(day.getFullYear(), day.getMonth(), day.getDate(), 12, 0, 0),
        stsBefore: before,
        stsAfter: Math.max(0, round2(before - row.amount)),
        flagged: false,
        refundedFrom: null,
      });
    }
    await store.updateRecurring(row.id, { lastPostedOn: startOfDay(days[days.length - 1]) });

    // The streak is built from day stats, so a scheduled charge has to land in
    // them exactly like a typed one.
    const state = await buildBudgetState(userId);
    await store.upsertDayStat({
      userId,
      day: dayKey(now),
      spent: state.spentToday,
      stsTarget: Math.round(openingTarget * 100) / 100,
      withinBudget: state.spentToday <= openingTarget,
    });

    results.push({
      id: row.id,
      name: row.name,
      amount: row.amount,
      count: days.length,
      total,
      dates: days.map(dayKey),
    });
  }

  const lines = results.map((r) =>
    r.count === 1
      ? `${r.name} ${fmt(r.amount)} posted for today.`
      : `${r.name} caught up: ${r.count} days, ${fmt(r.total)}.`
  );

  if (lines.length) {
    await store.addChatMessage({
      id: safeUuid(),
      userId,
      role: "assistant",
      kind: "log_card",
      payload: {
        text: `${lines.join(" ")} Scheduled payments go in on their own. You can remove any charge you didn't make, straight from History.`,
      },
      createdAt: new Date(),
    });
  }

  return results;
}

// ── skip ────────────────────────────────────────────────────────────────────

/**
 * "I didn't have class today." Removes the posted transaction but keeps
 * `lastPostedOn` where it is, so the catch-up won't put it back.
 */
async function skipOccurrence(userId: string, id?: string, day?: string) {
  if (!id) return NextResponse.json({ error: "Which schedule?" }, { status: 400 });
  const store = getStore();
  const row = (await store.listRecurring(userId)).find((r) => r.id === id);
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const target = day ? (parseDay(day) ?? startOfDay(new Date())) : startOfDay(new Date());
  const { rows } = await store.listTransactions(userId, { page: 0, pageSize: 500 });
  const match = rows.find(
    (t) => t.recurringId === id && dayKey(new Date(t.spentAt)) === dayKey(target)
  );
  if (!match) {
    return NextResponse.json({ error: "Nothing was posted for that day." }, { status: 404 });
  }

  await store.deleteTransaction(match.id);
  return NextResponse.json({ ok: true, recurring: await listFor(userId) });
}

type PostedOccurrence = {
  id: string;
  name: string;
  amount: number;
  count: number;
  total: number;
  dates: string[];
};

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}
const round2 = (n: number) => Math.round(n * 100) / 100;
