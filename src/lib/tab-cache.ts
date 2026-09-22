"use client";

/**
 * Client navigation should feel like changing tabs in an installed app, not
 * opening a new page. Keep the last successful response in memory and in the
 * current session so a remounted tab can paint it before revalidating.
 */
const memory = new Map<string, unknown>();

export function readTabCache<T>(key: string, fallback: T): T {
  if (memory.has(key)) return memory.get(key) as T;
  if (typeof window === "undefined") return fallback;

  try {
    const raw = window.sessionStorage.getItem(`budgetflow.tab.${key}`);
    if (!raw) return fallback;
    const value = JSON.parse(raw) as T;
    memory.set(key, value);
    return value;
  } catch {
    return fallback;
  }
}

export function writeTabCache<T>(key: string, value: T): void {
  memory.set(key, value);
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(`budgetflow.tab.${key}`, JSON.stringify(value));
  } catch {
    // Private browsing can reject storage; memory remains useful for navigation.
  }
}

let warmInflight: Promise<void> | null = null;

/** Warm the data-heavy tabs while the authenticated shell is already open. */
export function warmTabCaches(force = false): Promise<void> {
  if (warmInflight) {
    return force ? warmInflight.then(() => warmTabCaches(false)) : warmInflight;
  }
  warmInflight = Promise.all([
    fetch("/api/transactions?page=0&pageSize=30")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) {
          writeTabCache("history.rows", data.rows ?? []);
          writeTabCache("history.total", data.total ?? 0);
        }
      })
      .catch(() => {}),
    fetch("/api/plans")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) writeTabCache("plans", data.plans ?? []);
      })
      .catch(() => {}),
    fetch("/api/recurring")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) writeTabCache("schedules", data.recurring ?? []);
      })
      .catch(() => {}),
  ]).then(() => undefined).finally(() => {
    warmInflight = null;
  });
  return warmInflight;
}
