import { getStore } from "@/lib/store";
import { decryptSecret } from "@/lib/auth/crypto";
import type { BudgetState } from "@/lib/engine/budget";
import { committedThisMonth, dueOccurrences, type Schedule } from "@/lib/engine/recurring";
import type { RecurringRow, UserRow } from "@/lib/store/types";

export type { Schedule };

/** A stored recurrence seen as a schedule by the pure engine. */
export function toSchedule(r: RecurringRow): Schedule {
  return {
    cadence: r.cadence,
    weekdays: r.weekdays,
    dayOfMonth: r.dayOfMonth,
    startDate: r.startDate,
    endDate: r.endDate,
    active: r.active,
  };
}

/** Everything the rest of this month still owes to recurring payments. */
export function committedUpcoming(rows: RecurringRow[], now: Date = new Date()): number {
  return (
    Math.round(
      rows.reduce((sum, r) => sum + committedThisMonth(toSchedule(r), r.amount, now), 0) * 100
    ) / 100
  );
}

/** Occurrences that should already be in the ledger, oldest first. */
export function pendingPosts(
  rows: RecurringRow[],
  now: Date = new Date()
): { row: RecurringRow; due: Date[] }[] {
  return rows
    .map((row) => ({ row, due: dueOccurrences(toSchedule(row), row.lastPostedOn, now) }))
    .filter((x) => x.due.length > 0);
}

export async function getUserApiKey(user: UserRow): Promise<string | null> {
  if (!user.geminiApiKeyEnc) return null;
  try {
    return decryptSecret(user.geminiApiKeyEnc);
  } catch {
    return null;
  }
}

export async function buildBudgetState(userId: string): Promise<BudgetState> {
  const store = getStore();
  const [user, cats, recurring] = await Promise.all([
    store.getUserById(userId),
    store.getCategories(userId),
    store.listRecurring(userId),
  ]);
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const { rows } = await store.listTransactions(userId, {
    from: monthStart,
    page: 0,
    pageSize: 1000,
  });

  const spentByCat = new Map<string, number>();
  let spentToday = 0;
  const today = new Date().toDateString();
  for (const t of rows) {
    if (t.categoryId) spentByCat.set(t.categoryId, (spentByCat.get(t.categoryId) ?? 0) + t.amount);
    if (new Date(t.spentAt).toDateString() === today) spentToday += t.amount;
  }

  return {
    income: user?.monthlyIncome ?? 0,
    hardSavingsGoal: user?.hardSavingsGoal ?? 0,
    spentToday,
    committedPending: 0,
    committedUpcoming: committedUpcoming(recurring.filter((r) => r.active)),
    categories: cats.map((c) => ({
      id: c.id,
      name: c.name,
      monthlyCap: c.monthlyCap,
      flexible: c.flexible,
      spent: spentByCat.get(c.id) ?? 0,
    })),
  };
}

export const fmt = (n: number) =>
  `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
