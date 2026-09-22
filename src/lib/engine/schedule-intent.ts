/**
 * "I pay ₱100 for transport every Mon, Wed and Fri" → a schedule draft.
 *
 * Deterministic on purpose. Money-changing intent is never inferred by a model:
 * the same sentence always yields the same draft, it costs nothing to run, and
 * it can be tested against real phrasing instead of vibes.
 *
 * This only *reads* the sentence. Nothing is written until the user taps.
 */
import { describeSchedule, monthlyEstimate, unique, type Cadence, type Schedule } from "./recurring";
import { parseFallback } from "./parse";

export type ScheduleIntent = {
  name: string;
  amount: number;
  cadence: Cadence;
  /** weekly only. Empty means the sentence said "every class day", so the days are unknown. */
  weekdays: number[];
  /** monthly only. */
  dayOfMonth: number | null;
  /** "every Mon, Wed and Fri" · "every day" · "on the 1st of each month" */
  when: string;
  /** What the rhythm costs a month, for the "can I hold this?" line. */
  monthlyEstimate: number;
  /** True when a rhythm was described but not which days. */
  needsDays: boolean;
};

const DAY_INDEX: Record<string, number> = {
  sun: 0, sunday: 0,
  mon: 1, monday: 1,
  tue: 2, tues: 2, tuesday: 2,
  wed: 3, weds: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
};

const DAY_PATTERN =
  /\b(sun|sunday|mon|monday|tue|tues|tuesday|wed|weds|wednesday|thu|thur|thurs|thursday|fri|friday|sat|saturday)\b/g;

export function parseScheduleIntent(text: string, now: Date = new Date()): ScheduleIntent | null {
  const t = text.trim();
  if (!t || t.length < 4) return null;

  // "on the 1st": strip ordinals before looking for the amount, so the day
  // can never masquerade as the price.
  const withoutOrdinals = t.replace(/\b\d{1,2}(?:st|nd|rd|th)\b/gi, " ");
  const parsed = parseFallback(withoutOrdinals);
  if (!parsed || parsed.amount <= 0) return null;
  const amount = parsed.amount;

  const days = unique(
    (t.toLowerCase().match(DAY_PATTERN) ?? []).map((d) => DAY_INDEX[d])
  ).sort((a, b) => a - b);

  const everyDay = /\b(daily|every ?day|each day|every morning|every night)\b/i.test(t);
  const everyWeekday = /\b(every ?week ?day|on weekdays|each week ?day)\b/i.test(t);
  const weekend = /\b(every|each) weekend\b/i.test(t);
  const ordinal = t.match(/\b\d{1,2}(?:st|nd|rd|th)\b/i);
  const monthly =
    /\b(monthly|per month|every month|each month|a month|on the \d{1,2}(?:st|nd|rd|th))\b/i.test(t);
  // "every class day", "on school days": a rhythm with days only the user knows.
  const vagueDays =
    /\b(every|each|on|per)\s+(my\s+)?(class|school|work|office|shift)s?\s?days?\b/i.test(t);

  const hasRhythm = everyDay || everyWeekday || weekend || days.length > 0 || monthly || vagueDays;
  if (!hasRhythm) return null;

  const cadence: Cadence = everyDay ? "daily" : monthly && !days.length && !everyWeekday ? "monthly" : "weekly";

  let weekdays: number[] = [];
  let dayOfMonth: number | null = null;
  if (cadence === "weekly") {
    weekdays = everyWeekday ? [1, 2, 3, 4, 5] : weekend ? [0, 6] : days;
  } else if (cadence === "monthly") {
    dayOfMonth = ordinal ? clampDay(Number(ordinal[0].replace(/\D/g, ""))) : now.getDate();
  }

  if (cadence === "weekly" && weekdays.length === 0 && !vagueDays) return null;

  const schedule: Schedule = {
    cadence,
    weekdays,
    dayOfMonth,
    startDate: now,
    endDate: null,
    active: true,
  };

  return {
    name: nameFrom(t),
    amount,
    cadence,
    weekdays,
    dayOfMonth,
    when: describeSchedule(schedule),
    monthlyEstimate: monthlyEstimate(schedule, amount),
    needsDays: cadence === "weekly" && weekdays.length === 0,
  };
}

/** Anything that isn't the amount or the rhythm is probably what it's for. */
function nameFrom(text: string): string {
  let t = ` ${text.toLowerCase()} `;
  t = t.replace(/[₱$€£]\s?\d+(?:[.,]\d{1,2})?/g, " ");
  t = t.replace(/\b\d+(?:[.,]\d{1,2})?\s?(?:pesos?|dollars?|bucks?|php|usd)\b/g, " ");
  t = t.replace(/\b\d{1,2}(?:st|nd|rd|th)\b/g, " ");
  t = t.replace(/\b\d+(?:[.,]\d{1,2})?\b/g, " ");
  // Drop the rhythm phrase as a whole first, so "every class day" can't leave
  // "class" behind in the name.
  t = t.replace(
    /\b(every|each|on|per)\s+(my\s+)?(class|school|work|office|shift)s?\s?days?\b/gi,
    " "
  );
  t = t.replace(
    /\b(every|each|daily|weekly|monthly|per|weekdays?|weekends?|mornings?|nights?|around|about|roughly|approximately|on|the|of|for|from|to|my|i|pay|pays|paid|spend|spends|set|aside|start|starting|subscription|recurring|scheduled|auto|and)\b/g,
    " "
  );
  t = t.replace(DAY_PATTERN, " ");
  t = t.replace(/[.,;:!?"'()]/g, " ");

  const words = t.split(/\s+/).filter(Boolean).slice(0, 3);
  if (words.length === 0) return "Scheduled payment";
  return words.map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}

const clampDay = (n: number) => Math.min(31, Math.max(1, n));
