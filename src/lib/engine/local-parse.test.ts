import { test } from "node:test";
import assert from "node:assert/strict";
import { readLocally } from "./local-parse";

const cat = (id: string, name: string) => ({ id, name, flexible: true });

const KAIN = cat("c1", "Kain");
const PAMASAHE = cat("c2", "Pamasahe");
const INUMAN = cat("c3", "Inuman");
const SETUP = cat("c4", "Setup");

const FILIPINO_BUDGET = [KAIN, PAMASAHE, INUMAN, SETUP];

test("a plain spend lands locally with no AI call", () => {
  const r = readLocally("coffee 130", FILIPINO_BUDGET);
  assert.ok(r);
  assert.equal(r.confident, true);
  assert.equal(r.categoryId, INUMAN.id);
  assert.equal(r.group, "drinks");
  assert.equal(r.draft?.amount, 130);
});

test("the same words go to the model when no category can hold them", () => {
  // Nothing in this budget reads as a drink, so guessing would be invention.
  const r = readLocally("coffee 130", [cat("a", "Shopping"), cat("b", "Fun")]);
  assert.ok(r);
  assert.equal(r.confident, false);
  assert.equal(r.categoryId, null);
  assert.equal(r.draft?.amount, 130);
});

test("naming a category out loud beats the keyword groups", () => {
  const r = readLocally("Kain 200", FILIPINO_BUDGET);
  assert.ok(r);
  assert.equal(r.confident, true);
  assert.equal(r.categoryId, KAIN.id);
  assert.equal(r.group, "named");
});

test("two different groups in one line is ambiguous, so the model decides", () => {
  // Both groups resolve to a real category, so a local coin-flip would be wrong.
  const r = readLocally("lunch 120 and coffee 100", FILIPINO_BUDGET);
  assert.ok(r);
  assert.equal(r.confident, false);
  assert.equal(r.categoryId, null);
});

test("two words from the same group still resolve to one category", () => {
  const r = readLocally("lunch at the carinderia 95", FILIPINO_BUDGET);
  assert.ok(r);
  assert.equal(r.confident, true);
  assert.equal(r.categoryId, KAIN.id);
});

test("local words map onto the user's own category names", () => {
  const r = readLocally("jeepney fare 13", FILIPINO_BUDGET);
  assert.ok(r);
  assert.equal(r.confident, true);
  assert.equal(r.categoryId, PAMASAHE.id);
});

test("a message with no amount is conversation, not a spend", () => {
  assert.equal(readLocally("how much can I spend today?", FILIPINO_BUDGET), null);
});

test("word boundaries hold: a group word inside a longer word does not fire", () => {
  // "gassing" contains "gas", but the transport group must not claim it here.
  const r = readLocally("paid 300 for gassing up", [cat("x", "Fun")]);
  assert.ok(r);
  assert.equal(r.confident, false);
});

test("a refund is still read locally, for the same speed", () => {
  const r = readLocally("refund 250 from Steam", [cat("x", "Games")]);
  assert.ok(r);
  assert.equal(r.confident, true);
  assert.equal(r.draft?.refund, true);
  assert.equal(r.categoryId, "x");
});
