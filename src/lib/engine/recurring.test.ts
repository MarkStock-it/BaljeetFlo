import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  committedThisMonth,
  daysBetween,
  describeSchedule,
  dueOccurrences,
  monthlyEstimate,
  nextOccurrence,
  occursOn,
  occurrencesBetween,
  remainingThisMonth,
  startOfDay,
  type Schedule,
} from "./recurring";

// 2026-09-22 is a Tuesday; September 2026 has 30 days.
const TUE = new Date(2026, 8, 22, 9, 0, 0);

const sched = (over: Partial<Schedule> = {}): Schedule => ({
  cadence: "weekly",
  weekdays: [1, 3, 5], // Mon, Wed, Fri
  dayOfMonth: null,
  startDate: new Date(2026, 8, 1),
  endDate: null,
  active: true,
  ...over,
});

// ── Cadence matching ──────────────────────────────────────────────────────

test("weekly: only fires on the chosen weekdays", () => {
  const s = sched();
  assert.equal(occursOn(s, new Date(2026, 8, 21)), true); // Monday
  assert.equal(occursOn(s, new Date(2026, 8, 22)), false); // Tuesday
  assert.equal(occursOn(s, new Date(2026, 8, 23)), true); // Wednesday
  assert.equal(occursOn(s, new Date(2026, 8, 27)), false); // Sunday
});

test("daily: fires every day", () => {
  const s = sched({ cadence: "daily", weekdays: [] });
  assert.equal(occursOn(s, new Date(2026, 8, 22)), true);
  assert.equal(occursOn(s, new Date(2026, 8, 23)), true);
});

test("monthly: clamps to the last day of a short month", () => {
  // Start in January so the earlier months are actually in range.
  const s = sched({
    cadence: "monthly",
    weekdays: [],
    dayOfMonth: 31,
    startDate: new Date(2026, 0, 1),
  });
  assert.equal(occursOn(s, new Date(2026, 0, 31)), true); // January has 31
  assert.equal(occursOn(s, new Date(2026, 1, 28)), true); // February clamps to 28
  assert.equal(occursOn(s, new Date(2026, 8, 30)), true); // September has 30
  assert.equal(occursOn(s, new Date(2026, 8, 29)), false);
});

test("monthly: a date before the start date never fires", () => {
  const s = sched({ cadence: "monthly", weekdays: [], dayOfMonth: 15 }); // starts 1 Sep
  assert.equal(occursOn(s, new Date(2026, 7, 15)), false);
  assert.equal(occursOn(s, new Date(2026, 8, 15)), true);
});

test("inactive schedules never fire, even on a matching day", () => {
  assert.equal(occursOn(sched({ active: false }), new Date(2026, 8, 21)), false);
});

test("dates before start and after end are excluded", () => {
  const s = sched({
    cadence: "daily",
    weekdays: [],
    startDate: new Date(2026, 8, 10),
    endDate: new Date(2026, 8, 20),
  });
  assert.equal(occursOn(s, new Date(2026, 8, 9)), false);
  assert.equal(occursOn(s, new Date(2026, 8, 10)), true);
  assert.equal(occursOn(s, new Date(2026, 8, 20)), true);
  assert.equal(occursOn(s, new Date(2026, 8, 21)), false);
});

test("range scan is inclusive at both ends and ignores times of day", () => {
  const s = sched({ cadence: "daily", weekdays: [] });
  const got = occurrencesBetween(s, new Date(2026, 8, 20, 23, 59), new Date(2026, 8, 22, 0, 1));
  assert.equal(got.length, 3);
  assert.equal(daysBetween(got[0], got[2]), 2);
});

// ── Catch-up posting ──────────────────────────────────────────────────────

test("catch-up posts every missed occurrence up to today", () => {
  const s = sched({ cadence: "daily", weekdays: [] });
  const due = dueOccurrences(s, addDays(TUE, -3), TUE);
  assert.equal(due.length, 3); // Fri? no: daily, so Sat, Sun, Mon, Tue minus the posted day
  assert.equal(due.length, due.filter((d) => daysBetween(d, TUE) <= 3).length);
});

test("catch-up is idempotent: a second run the same day posts nothing", () => {
  const s = sched();
  const first = dueOccurrences(s, null, TUE);
  // Sep 1 2026 is a Tuesday: Wed 2, Fri 4, Mon 7, Wed 9, Fri 11, Mon 14, Wed 16,
  // Fri 18 and Mon 21 all fall on or before the morning of Tue 22.
  assert.equal(first.length, 9);
  assert.deepEqual(dueOccurrences(s, TUE, TUE), []);
  // The next day posts exactly one more, and only because it is a class day.
  const tomorrow = dueOccurrences(s, TUE, addDays(TUE, 1));
  assert.equal(tomorrow.length, 1);
  assert.equal(tomorrow[0].getDay(), 3); // Wednesday
});

test("catch-up only posts on schedule days", () => {
  const s = sched(); // Mon, Wed, Fri
  const due = dueOccurrences(s, new Date(2026, 8, 18), TUE); // last posted Fri 18th
  assert.deepEqual(
    due.map((d) => d.getDay()),
    [1] // only Monday 21st lies between Fri 18th and Tue 22nd
  );
});

test("catch-up from nothing reaches back only as far as the start date", () => {
  const s = sched({ cadence: "daily", weekdays: [], startDate: new Date(2026, 8, 20) });
  assert.equal(dueOccurrences(s, null, TUE).length, 3);
});

test("catch-up backfill is capped so an old schedule can't flood the ledger", () => {
  const s = sched({ cadence: "daily", weekdays: [], startDate: new Date(2020, 0, 1) });
  assert.equal(dueOccurrences(s, null, TUE).length, 32); // 31 days back plus today
});

test("a future-dated schedule posts nothing yet", () => {
  const s = sched({ cadence: "daily", weekdays: [], startDate: addDays(TUE, 5) });
  assert.deepEqual(dueOccurrences(s, null, TUE), []);
});

test("an ended schedule posts its own run, then stops", () => {
  const s = sched({ cadence: "daily", weekdays: [], endDate: addDays(TUE, -2) });
  const due = dueOccurrences(s, null, TUE);
  assert.equal(due.length, 20); // Sep 1 through Sep 20 inclusive
  assert.ok(due.every((d) => d.getTime() <= addDays(TUE, -2).getTime()));
  assert.deepEqual(dueOccurrences(s, addDays(TUE, -2), TUE), []);
});

// ── What the rest of the month owes ───────────────────────────────────────

test("remaining this month counts only days after today", () => {
  const s = sched(); // Mon, Wed, Fri
  // From Tue 22 Sep: Wed 23, Fri 25, Mon 28, Wed 30. Sep ends on the 30th.
  assert.equal(remainingThisMonth(s, TUE).length, 4);
  assert.equal(committedThisMonth(s, 100, TUE), 400);
});

test("remaining this month is empty on the last day", () => {
  const s = sched();
  assert.equal(remainingThisMonth(s, new Date(2026, 8, 30)).length, 0);
  assert.equal(committedThisMonth(s, 100, new Date(2026, 8, 30)), 0);
});

test("a daily schedule commits the rest of the month", () => {
  const s = sched({ cadence: "daily", weekdays: [] });
  assert.equal(committedThisMonth(s, 100, new Date(2026, 8, 1)), 2900); // the 2nd through the 30th
});

// ── Next occurrence + wording ─────────────────────────────────────────────

test("next occurrence looks forward from today, including today", () => {
  const s = sched();
  assert.equal(nextOccurrence(s, new Date(2026, 8, 21))?.getDate(), 21); // Monday itself
  assert.equal(nextOccurrence(s, TUE)?.getDate(), 23); // next Wednesday
  assert.equal(nextOccurrence(sched({ active: false }), TUE), null);
});

test("descriptions read like a sentence", () => {
  assert.equal(describeSchedule(sched()), "every Mon, Wed and Fri");
  assert.equal(describeSchedule(sched({ weekdays: [1] })), "every Mon");
  assert.equal(describeSchedule(sched({ weekdays: [0, 6] })), "every weekend");
  assert.equal(describeSchedule(sched({ weekdays: [1, 2, 3, 4, 5] })), "every weekday");
  assert.equal(describeSchedule(sched({ cadence: "daily", weekdays: [] })), "every day");
  assert.equal(
    describeSchedule(sched({ cadence: "monthly", weekdays: [], dayOfMonth: 15 })),
    "on the 15th of each month"
  );
  assert.equal(
    describeSchedule(sched({ cadence: "monthly", weekdays: [], dayOfMonth: 1 })),
    "on the 1st of each month"
  );
});

test("monthly estimate reflects the cadence", () => {
  assert.equal(monthlyEstimate(sched({ cadence: "daily", weekdays: [] }), 100), 3040);
  assert.equal(monthlyEstimate(sched({ cadence: "monthly", weekdays: [] }), 250), 250);
  assert.equal(monthlyEstimate(sched(), 100), 1305); // 3 × 4.35 × 100
});

test("no schedule can scan forever: a 40-year-old daily schedule returns in bounded time", () => {
  const s = sched({ cadence: "daily", weekdays: [], startDate: new Date(1986, 0, 1) });
  const started = Date.now();
  occurrencesBetween(s, new Date(1986, 0, 1), new Date(2026, 8, 22));
  assert.ok(Date.now() - started < 2000);
});

test("startOfDay strips the time so day comparisons are stable", () => {
  const d = startOfDay(new Date(2026, 8, 22, 23, 59, 59));
  assert.equal(d.getHours(), 0);
  assert.equal(d.getDate(), 22);
});
