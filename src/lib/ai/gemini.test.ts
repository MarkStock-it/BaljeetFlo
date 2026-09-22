import assert from "node:assert/strict";
import { test, beforeEach, afterEach } from "node:test";
import { cleanKeyInput, validateKey, geminiJson, GeminiError, resetModelCache } from "./gemini";

const realFetch = globalThis.fetch;
let calls: { url: string; headers: Headers; body: string }[] = [];

/** Mock the endpoint: reply per model id, or a fixed status for all. */
function mockFetch(responder: (model: string) => { status: number; body?: unknown }) {
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    const model = /models\/([^:]+):/.exec(u)?.[1] ?? "unknown";
    calls.push({ url: u, headers: new Headers(init?.headers), body: String(init?.body ?? "") });
    const { status, body } = responder(model);
    return new Response(JSON.stringify(body ?? { error: { code: status } }), { status });
  }) as typeof fetch;
}

function ok(body: unknown) {
  return { status: 200, body };
}

beforeEach(() => {
  calls = [];
  resetModelCache();
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("cleanKeyInput strips whitespace and stray quotes", () => {
  assert.equal(cleanKeyInput('  AQ.Ab8RN6xyz  '), "AQ.Ab8RN6xyz");
  assert.equal(cleanKeyInput('"AIzaSyABC123"\n'), "AIzaSyABC123");
  assert.equal(cleanKeyInput("  "), "");
});

test("key travels in x-goog-api-key and never in the URL or as Bearer", async () => {
  mockFetch(() => ok({ candidates: [{ content: { parts: [{ text: "{}" }] } }] }));
  await validateKey("AQ.Ab8RN6verylongkeyvalue0000000000000000");
  const h = calls[0].headers;
  assert.equal(h.get("x-goog-api-key"), "AQ.Ab8RN6verylongkeyvalue0000000000000000");
  assert.equal(h.get("authorization"), null);
  assert.ok(!calls[0].url.includes("key="));
});

test("retired model (404) falls through to the next candidate", async () => {
  mockFetch((model) =>
    model === "gemini-3.6-flash"
      ? { status: 404, body: { error: { message: "This model is no longer available." } } }
      : ok({ candidates: [{ content: { parts: [{ text: "{}" }] } }] })
  );
  const r = await validateKey("AQ.Ab8RN6verylongkeyvalue0000000000000000");
  assert.equal(r.ok, true);
  assert.deepEqual(
    calls.map((c) => /models\/([^:]+):/.exec(c.url)?.[1]),
    ["gemini-3.6-flash", "gemini-2.5-flash"]
  );
});

test("the model that answered is remembered, so the next call does not re-walk", async () => {
  mockFetch((model) =>
    model === "gemini-3.6-flash"
      ? { status: 404, body: { error: { message: "gone" } } }
      : ok({ candidates: [{ content: { parts: [{ text: "{}" }] } }] })
  );
  await validateKey("AQ.Ab8RN6verylongkeyvalue0000000000000000");
  calls = [];
  await validateKey("AQ.Ab8RN6verylongkeyvalue0000000000000000");
  assert.equal(calls.length, 1);
  assert.equal(/models\/([^:]+):/.exec(calls[0].url)?.[1], "gemini-2.5-flash");
});

test("overloaded model (503) also walks on, but a good key still passes", async () => {
  mockFetch((model) =>
    model === "gemini-3.6-flash"
      ? { status: 503, body: { error: { message: "high demand" } } }
      : ok({ candidates: [{ content: { parts: [{ text: "{}" }] } }] })
  );
  const r = await validateKey("AQ.Ab8RN6verylongkeyvalue0000000000000000");
  assert.equal(r.ok, true);
  assert.equal(calls.length, 2);
});

test("a key is still accepted when every model is merely overloaded", async () => {
  mockFetch(() => ({ status: 503, body: { error: { message: "high demand" } } }));
  const r = await validateKey("AQ.Ab8RN6verylongkeyvalue0000000000000000");
  assert.equal(r.ok, true);
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

test("401 shows the code and stays free of Google jargon", async () => {
  mockFetch(() => ({ status: 401, body: { error: { message: "Request had invalid authentication credentials." } } }));
  const r = await validateKey("AQ.Ab8RN6verylongkeyvalue0000000000000000");
  assert.equal(r.ok, false);
  assert.ok(!r.ok && /401/.test(r.message));
  assert.ok(!r.ok && !/Request had invalid/.test(r.message));
});

test("403 and 429 map to their own guidance with codes", async () => {
  mockFetch(() => ({ status: 403, body: { error: { message: "PERMISSION_DENIED" } } }));
  const f = await validateKey("AQ.Ab8RN6verylongkeyvalue0000000000000000");
  assert.ok(!f.ok && /403/.test(f.message) && /restrict/i.test(f.message));

  resetModelCache();
  mockFetch(() => ({ status: 429, body: { error: { message: "quota" } } }));
  const q = await validateKey("AQ.Ab8RN6verylongkeyvalue0000000000000000");
  assert.ok(!q.ok && /429/.test(q.message) && /quota/i.test(q.message));
});

test("a stalled upstream fails fast instead of holding the request open", async () => {
  globalThis.fetch = (async () => {
    throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
  }) as typeof fetch;

  const r = await validateKey("AQ.Ab8RN6verylongkeyvalue0000000000000000");
  assert.equal(r.ok, false);
  assert.ok(!r.ok && /reach Google/.test(r.message));

  resetModelCache();
  await assert.rejects(
    () => geminiJson({ apiKey: "AQ.Ab8RN6verylongkeyvalue0000000000000000", prompt: "x", schema: { type: "object" } }),
    (e: unknown) => e instanceof GeminiError && e.status === 503
  );
});

test("geminiJson returns parsed JSON and types failures", async () => {
  mockFetch(() => ok({ candidates: [{ content: { parts: [{ text: '{"amount":140}' }] } }] }));
  const parsed = await geminiJson<{ amount: number }>({
    apiKey: "AQ.Ab8RN6verylongkeyvalue0000000000000000",
    prompt: "x",
    schema: { type: "object" },
  });
  assert.equal(parsed.amount, 140);

  resetModelCache();
  mockFetch(() => ({ status: 404, body: { error: { message: "This model is no longer available." } } }));
  await assert.rejects(
    () => geminiJson({ apiKey: "AQ.Ab8RN6verylongkeyvalue0000000000000000", prompt: "x", schema: { type: "object" } }),
    (e: unknown) => e instanceof GeminiError && e.status === 404
  );
});
