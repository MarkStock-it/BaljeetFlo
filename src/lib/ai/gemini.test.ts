import assert from "node:assert/strict";
import { test, beforeEach, afterEach } from "node:test";
import { cleanKeyInput, validateKey } from "./gemini";

const realFetch = globalThis.fetch;
let lastHeaders: HeadersInit | null = null;

function mockFetch(status: number) {
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    lastHeaders = init?.headers ?? null;
    return new Response(JSON.stringify({ error: { code: status } }), { status });
  }) as typeof fetch;
}

beforeEach(() => {
  lastHeaders = null;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("cleanKeyInput strips whitespace and stray quotes", () => {
  assert.equal(cleanKeyInput('  AQ.Ab8RN6xyz  '), "AQ.Ab8RN6xyz");
  assert.equal(cleanKeyInput('"AIzaSyABC123"\n'), "AIzaSyABC123");
  assert.equal(cleanKeyInput("'AQ.x'\t"), "AQ.x");
  assert.equal(cleanKeyInput("  "), "");
});

test("valid AQ key passes and is returned cleaned", async () => {
  mockFetch(200);
  const r = await validateKey("  AQ.Ab8RN6verylongkeyvalue0000000000000000  ");
  assert.equal(r.ok, true);
  assert.ok(r.ok && r.clean === "AQ.Ab8RN6verylongkeyvalue0000000000000000");
});

test("valid legacy AIza key still works", async () => {
  mockFetch(200);
  const r = await validateKey("AIzaSyA1234567890abcdefghijklmnopqrstuv");
  assert.ok(r.ok);
});

test("key is sent in the x-goog-api-key header, never in the URL or as Bearer", async () => {
  mockFetch(200);
  await validateKey("AQ.Ab8RN6verylongkeyvalue0000000000000000");
  const h = new Headers(lastHeaders ?? undefined);
  assert.equal(h.get("x-goog-api-key"), "AQ.Ab8RN6verylongkeyvalue0000000000000000");
  assert.equal(h.get("authorization"), null);
});

test("garbage input is rejected by shape before any network call", async () => {
  globalThis.fetch = (async () => {
    throw new Error("network must not be touched");
  }) as typeof fetch;
  for (const bad of ["", "hello", "key=AQ.x", "AIza"]) {
    const r = await validateKey(bad);
    assert.equal(r.ok, false, `expected reject for ${bad}`);
  }
});

test("truncated AQ key is caught by shape with a paste message", async () => {
  globalThis.fetch = (async () => {
    throw new Error("network must not be touched");
  }) as typeof fetch;
  const r = await validateKey("AQ.short");
  assert.equal(r.ok, false);
  assert.ok(!r.ok && /cut off/.test(r.message));
});

test("401 maps to a key-rejected message that mentions re-pasting for AQ", async () => {
  mockFetch(401);
  const r = await validateKey("AQ.Ab8RN6verylongkeyvalue0000000000000000");
  assert.equal(r.ok, false);
  assert.ok(!r.ok && /rejected/.test(r.message));
});

test("403 maps to the restriction guidance", async () => {
  mockFetch(403);
  const r = await validateKey("AQ.Ab8RN6verylongkeyvalue0000000000000000");
  assert.equal(r.ok, false);
  assert.ok(!r.ok && /restrict/i.test(r.message));
});

test("429 maps to quota messaging, not invalid key", async () => {
  mockFetch(429);
  const r = await validateKey("AQ.Ab8RN6verylongkeyvalue0000000000000000");
  assert.equal(r.ok, false);
  assert.ok(!r.ok && /quota/.test(r.message));
});
