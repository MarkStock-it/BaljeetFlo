import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFallback } from "./parse";

/**
 * The no-AI path. This is what runs when the user has no Gemini key, or when
 * theirs is out of quota, so it has to stay boring and predictable.
 */

test("amount with a currency mark", () => {
  const d = parseFallback("₱140 on groceries");
  assert.ok(d);
  assert.equal(d.amount, 140);
  assert.equal(d.refund, false);
});

test("bare number after a verb", () => {
  const d = parseFallback("Spent 140 on groceries");
  assert.ok(d);
  assert.equal(d.amount, 140);
});

test("a sentence-initial verb is never treated as the vendor", () => {
  const d = parseFallback("Spent 140 on groceries");
  assert.ok(d);
  assert.equal(d.vendor, undefined);
});

test("a real merchant is still picked out", () => {
  const d = parseFallback("Spent 180 at Jollibee");
  assert.ok(d);
  assert.equal(d.vendor, "Jollibee");
});

test("refunds are flagged", () => {
  const d = parseFallback("Got refunded 250 from Steam");
  assert.ok(d);
  assert.equal(d.refund, true);
  assert.equal(d.amount, 250);
});

test("no amount means no transaction", () => {
  assert.equal(parseFallback("Coffee please"), null);
});
