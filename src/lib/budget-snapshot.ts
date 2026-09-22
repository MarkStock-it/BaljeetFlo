"use client";

import { useEffect, useSyncExternalStore } from "react";

/**
 * One budget snapshot for the whole app.
 *
 * Every tab used to fetch /api/budget on mount and hold it in page state, so
 * switching tabs painted a zero and then swapped in the real number a moment
 * later. The number is the product, so it must never blink. This module keeps
 * the last snapshot in module scope (which survives client-side navigation),
 * mirrors it into sessionStorage so a relaunch shows what was last seen, and
 * lets pages read it during render through useSyncExternalStore.
 */

export type BudgetCategory = {
  id: string;
  name: string;
  flexible: boolean;
  cap: number;
  spent: number;
  /** cap minus spent, computed server-side. */
  remaining: number;
};

/**
 * Every field below is always sent by /api/budget, so the type says so. Making
 * them optional would only push defensive guards through every screen.
 */
export type BudgetSnapshot = {
  income: number;
  hardSavingsGoal: number;
  safeToSpend: number;
  spentToday: number;
  reminderHour: number;
  hasGeminiKey: boolean;
  planReserved: number;
  monthTransactions: number;
  recurringCommitted: number;
  categories: BudgetCategory[];
  allocation: {
    pool: number;
    flexiblePool: number;
    allocated: number;
    over: number;
    unallocated: number;
    ok: boolean;
  };
  plans: { id: string; name: string; targetAmount: number; monthlySetAside: number }[];
  recurring: { id: string; name: string; amount: number }[];
  stack: { pct: number; blocks: number; streakDays: number };
};

const STORAGE_KEY = "budgetflow.budget";
/** How long a snapshot counts as fresh enough to skip a background refetch. */
const FRESH_MS = 5000;

let snapshot: BudgetSnapshot | null = null;
let fetchedAt = 0;
let inflight: Promise<BudgetSnapshot | null> | null = null;
const listeners = new Set<() => void>();

// Client-only: restore what this session last saw, before the first fetch.
if (typeof window !== "undefined") {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (raw) snapshot = JSON.parse(raw) as BudgetSnapshot;
  } catch {
    // Corrupt or unavailable storage is not worth reporting: we refetch.
  }
}

function emit() {
  // forEach, not for..of: this project's TS target cannot iterate a Set.
  listeners.forEach((listener) => listener());
}

function store(next: BudgetSnapshot) {
  snapshot = next;
  fetchedAt = Date.now();
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Private mode can refuse writes. The in-memory copy still works.
  }
  emit();
}

/** Current snapshot, readable during render. */
export function getBudgetSnapshot(): BudgetSnapshot | null {
  return snapshot;
}

/** Refetch from the server. Concurrent callers share one request. */
export async function refreshBudget(): Promise<BudgetSnapshot | null> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch("/api/budget");
      if (!res.ok) return snapshot;
      const data = (await res.json()) as BudgetSnapshot;
      store(data);
      return data;
    } catch {
      return snapshot;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Optimistic patch for screens that already know the new value. */
export function updateBudgetSnapshot(patch: Partial<BudgetSnapshot>) {
  if (!snapshot) return;
  store({ ...snapshot, ...patch });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getServerSnapshot(): BudgetSnapshot | null {
  return null;
}

/**
 * Read the shared snapshot. Paints the known value immediately and refreshes
 * behind it when the copy is stale, so no tab ever starts at zero.
 */
export function useBudgetSnapshot(): BudgetSnapshot | null {
  const snap = useSyncExternalStore(subscribe, getBudgetSnapshot, getServerSnapshot);
  useEffect(() => {
    if (!snapshot || Date.now() - fetchedAt > FRESH_MS) void refreshBudget();
  }, []);
  return snap;
}
