import { test } from "node:test";
import assert from "node:assert/strict";
import { parseScheduleIntent } from "./schedule-intent";

/** A fixed clock so a "on the 15th" default can never depend on the real date. */
const NOW = new Date(2026, 8, 22); // 22 Sep 2026, a Tuesday

test("class-day transport: name, amount and days all come out right", () => {
  const i = parseScheduleIntent("I pay 100 for transport every Monday, Wednesday and Friday", NOW);
  assert.ok(i);
  assert.equal(i.amount, 100);
  assert.equal(i.name, "Transport");
  assert.equal(i.cadence, "weekly");
  assert.deepEqual(i.weekdays, [1, 3, 5]);
  assert.equal(i.when, "every Mon, Wed and Fri");
  assert.equal(i.needsDays, false);
  assert.equal(i.monthlyEstimate, 1305); // 100 × 3 × 4.35
});

test("abbreviations and a currency mark", () => {
  const i = parseScheduleIntent("₱60 grab to school every mon, wed, fri", NOW);
  assert.ok(i);
  assert.equal(i.amount, 60);
  assert.deepEqual(i.weekdays, [1, 3, 5]);
});

test("every day", () => {
  const i = parseScheduleIntent("data 25 every day", NOW);
  assert.ok(i);
  assert.equal(i.cadence, "daily");
  assert.equal(i.dayOfMonth, null);
  assert.equal(i.when, "every day");
});

test("every weekday becomes Monday to Friday, not seven days", () => {
  const i = parseScheduleIntent("60 fare every weekday", NOW);
  assert.ok(i);
  assert.deepEqual(i.weekdays, [1, 2, 3, 4, 5]);
  assert.equal(i.when, "every weekday");
});

test("weekend", () => {
  const i = parseScheduleIntent("200 laundry every weekend", NOW);
  assert.ok(i);
  assert.deepEqual(i.weekdays, [0, 6]);
  assert.equal(i.when, "every weekend");
});

test("monthly on a named day: the ordinal is a date, never the price", () => {
  const i = parseScheduleIntent("Rent 8000 on the 1st", NOW);
  assert.ok(i);
  assert.equal(i.amount, 8000);
  assert.equal(i.cadence, "monthly");
  assert.equal(i.dayOfMonth, 1);
  assert.equal(i.name, "Rent");
  assert.equal(i.when, "on the 1st of each month");
});

test("monthly without a day falls back to today's date", () => {
  const i = parseScheduleIntent("Spotify 149 monthly", NOW);
  assert.ok(i);
  assert.equal(i.cadence, "monthly");
  assert.equal(i.dayOfMonth, 22);
});

test("a rhythm with days only the user knows is kept, flagged, not guessed", () => {
  const i = parseScheduleIntent("I pay around 100 for transport every class day", NOW);
  assert.ok(i);
  assert.equal(i.amount, 100);
  assert.equal(i.cadence, "weekly");
  assert.deepEqual(i.weekdays, []);
  assert.equal(i.needsDays, true);
});

test("plain spending is not a schedule", () => {
  assert.equal(parseScheduleIntent("Spent 180 at Jollibee", NOW), null);
  assert.equal(parseScheduleIntent("Grab to school, 60", NOW), null);
  assert.equal(parseScheduleIntent("Can I afford 1500 shoes?", NOW), null);
  assert.equal(parseScheduleIntent("Got refunded 250 from Steam", NOW), null);
  assert.equal(parseScheduleIntent("", NOW), null);
});

test("a rhythm with no amount is not a schedule either", () => {
  assert.equal(parseScheduleIntent("I pay for transport every Monday", NOW), null);
});
