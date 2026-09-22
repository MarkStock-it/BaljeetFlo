/**
 * Recurring payments: money on a rhythm.
 *
 * Transport on class days, a subscription on the 15th, data top-ups every
 * Monday. The user shouldn't have to type these in daily, and the Safe-to-Spend
 * number shouldn't pretend they don't exist: money promised later this month is
 * money that is not free to spend today.
 *
 * Pure functions with no clock of their own and no I/O. Posting is driven by
 * whoever calls `dueOccurrences` (the app does it on load), which makes the
 * catch-up idempotent by construction: `lastPostedOn` is the only state.
 */

export type Cadence = "daily" | "weekly" | "monthly";

export type Schedule = {
  cadence: Cadence;
  /** weekly only. 0 = Sunday … 6 = Saturday, matching Date.getDay(). */
  weekdays: number[];
  /** monthly only. 1 to 31, clamped to the last day of short months. */
  dayOfMonth: number | null;
  startDate: Date;
  endDate: Date | null;
  active: boolean;
};

export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Hard ceiling on any scan, so a bad schedule can never spin the server. */
const MAX_SCAN_DAYS = 400;
/** How far back a catch-up will reach, so a year-old schedule can't flood history. */
const MAX_BACKFILL_DAYS = 31;

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

export function daysBetween(a: Date, b: Date): number {
  return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / 86_400_000);
}

/** Does this schedule fall on `day`? */
export function occursOn(s: Schedule, day: Date): boolean {
  if (!s.active) return false;
  const d = startOfDay(day);
  if (d.getTime() < startOfDay(s.startDate).getTime()) return false;
  if (s.endDate && d.getTime() > startOfDay(s.endDate).getTime()) return false;

  if (s.cadence === "daily") return true;
  if (s.cadence === "weekly") return s.weekdays.includes(d.getDay());

  const wanted = s.dayOfMonth ?? startOfDay(s.startDate).getDate();
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return d.getDate() === Math.min(wanted, lastDay);
}

/** Every occurrence in [from, to], both ends inclusive. */
export function occurrencesBetween(s: Schedule, from: Date, to: Date): Date[] {
  const out: Date[] = [];
  const end = startOfDay(to);
  let cursor = startOfDay(from);
  for (let i = 0; i <= MAX_SCAN_DAYS && cursor.getTime() <= end.getTime(); i++) {
    if (occursOn(s, cursor)) out.push(new Date(cursor));
    cursor = addDays(cursor, 1);
  }
  return out;
}

/**
 * What should already be in the ledger.
 *
 * Anything on or before `lastPostedOn` is already posted, so a second call in
 * the same day returns nothing. Backfill is capped so a schedule created with a
 * start date long in the past doesn't dump a year of entries at once.
 */
export function dueOccurrences(
  s: Schedule,
  lastPostedOn: Date | null,
  now: Date = new Date(),
  maxBackfillDays = MAX_BACKFILL_DAYS
): Date[] {
  if (!s.active) return [];
  const today = startOfDay(now);
  const floor = lastPostedOn ? addDays(startOfDay(lastPostedOn), 1) : startOfDay(s.startDate);
  const from = new Date(Math.max(floor.getTime(), addDays(today, -maxBackfillDays).getTime()));
  if (from.getTime() > today.getTime()) return [];
  return occurrencesBetween(s, from, today);
}

/** Occurrences still to come this month, strictly after today. */
export function remainingThisMonth(s: Schedule, now: Date = new Date()): Date[] {
  const today = startOfDay(now);
  const first = addDays(today, 1);
  const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  if (first.getTime() > endOfMonth.getTime()) return [];
  return occurrencesBetween(s, first, endOfMonth);
}

/** What the rest of this month still owes to this one schedule. */
export function committedThisMonth(s: Schedule, amount: number, now: Date = new Date()): number {
  return round2(remainingThisMonth(s, now).length * amount);
}

/** First occurrence on or after `from` (defaults to today), within two months. */
export function nextOccurrence(s: Schedule, from: Date = new Date()): Date | null {
  if (!s.active) return null;
  const start = startOfDay(from);
  return occurrencesBetween(s, start, addDays(start, 62))[0] ?? null;
}

/** Roughly what a month costs: 4.35 weeks, or the nth of each month. */
export function monthlyEstimate(s: Schedule, amount: number): number {
  if (s.cadence === "daily") return round2(amount * 30.4);
  if (s.cadence === "monthly") return round2(amount);
  return round2(amount * s.weekdays.length * 4.35);
}

/** "every day" · "every Mon, Wed and Fri" · "on the 15th of each month" */
export function describeSchedule(s: Schedule): string {
  if (s.cadence === "daily") return "every day";
  if (s.cadence === "monthly") {
    return `on the ${ordinal(s.dayOfMonth ?? startOfDay(s.startDate).getDate())} of each month`;
  }

  const days = unique(s.weekdays).sort((a, b) => a - b);
  if (days.length === 0) return "no days chosen";
  if (days.length === 7) return "every day";
  if (days.length === 5 && days.join() === "1,2,3,4,5") return "every weekday";
  if (days.length === 2 && days[0] === 0 && days[1] === 6) return "every weekend";

  const names = days.map((d) => WEEKDAY_LABELS[d]);
  if (names.length === 1) return `every ${names[0]}`;
  return `every ${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** One line for a schedule row: the rhythm plus when it lands next. */
export function scheduleSentence(s: Schedule, now: Date = new Date()): string {
  const when = describeSchedule(s);
  if (!s.active) return `Paused · ${when}`;
  const next = nextOccurrence(s, now);
  if (!next) return `Finished · ${when}`;
  if (daysBetween(now, next) === 0) return `${when} · next is today`;
  return `${when} · next ${next.toLocaleDateString("en-PH", {
    weekday: "short",
    month: "short",
    day: "numeric",
  })}`;
}

/** Dedupe without relying on Set iteration (the project targets ES2017 downlevel). */
export function unique<T>(values: T[]): T[] {
  return values.filter((v, i) => values.indexOf(v) === i);
}

function ordinal(n: number): string {
  const suffixes = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${suffixes[(v - 20) % 10] ?? suffixes[v] ?? suffixes[0]}`;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
