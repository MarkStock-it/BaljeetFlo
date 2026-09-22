const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * Model candidates, best first.
 *
 * Google retires flash models on a rolling schedule: gemini-2.0-flash now
 * answers 404 "no longer available", which broke every AI path at once for
 * every user. A single hardcoded id is therefore a time bomb, so calls walk
 * this list. The first model that answers (anything other than 404) is
 * remembered for the life of the process, and only a 404 sends us back to
 * the chain. Verified working against a live AQ auth key.
 */
const MODEL_CHAIN = ["gemini-3.6-flash", "gemini-2.5-flash"];
let resolvedModel: string | null = null;

/** Testing seam: forget which model answered, so a test can walk the chain. */
export function resetModelCache() {
  resolvedModel = null;
}

export class GeminiError extends Error {
  status: number;
  /** Google's own error text, when it sent one. Surfaced for debugging. */
  detail?: string;
  constructor(message: string, status: number, detail?: string) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

/**
 * Auth: every call sends the key in the x-goog-api-key header.
 *
 * Google migrated keys from standard (AIza...) to authorization keys (AQ.,
 * bound to a service account). Both types authenticate the native
 * generateContent endpoint the same way: x-goog-api-key header or ?key=.
 * Authorization: Bearer is the one that breaks (401 API_KEY_SERVICE_BLOCKED),
 * so it is never used here. The header beats ?key= because query strings
 * leak into access logs.
 */
function authHeaders(apiKey: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    "x-goog-api-key": apiKey,
  };
}

/** Trim the paste damage that breaks keys: whitespace, newlines, stray quotes. */
export function cleanKeyInput(raw: string): string {
  return raw
    .trim()
    .replace(/^["']+|["']+$/g, "")
    .trim();
}

type GoogleErrorBody = { code?: number; status?: string; message?: string };

async function readErrorBody(res: Response): Promise<GoogleErrorBody> {
  try {
    const data = (await res.json()) as { error?: GoogleErrorBody };
    return data?.error ?? {};
  } catch {
    return {};
  }
}

/** One line of Google's message, safe for a sentence. */
function summarise(message: string | undefined, fallback: string): string {
  if (!message) return fallback;
  const firstSentence = message.split(/(?<=\.)\s/)[0] ?? message;
  return firstSentence.replace(/\s+/g, " ").trim().slice(0, 180);
}

/**
 * POST to the first model that can serve. Two failures are worth walking past:
 * 404 (this id was retired) and 503 (this model is at capacity). Any other
 * answer is about the request or the key and is returned as-is, so a walk
 * never hides a real error or burns quota twice.
 */
const WALK_ON = new Set([404, 503]);

async function callChain(apiKey: string, body: unknown): Promise<Response> {
  const order = resolvedModel
    ? [resolvedModel, ...MODEL_CHAIN.filter((m) => m !== resolvedModel)]
    : MODEL_CHAIN;

  let last: Response | null = null;
  for (const model of order) {
    const res = await fetch(`${BASE}/${model}:generateContent`, {
      method: "POST",
      headers: authHeaders(apiKey),
      body: JSON.stringify(body),
    });
    if (!WALK_ON.has(res.status)) {
      resolvedModel = model;
      return res;
    }
    last = res;
  }
  return last as Response;
}

/** Map a failed response to a typed error that carries Google's own words. */
async function toGeminiError(res: Response): Promise<GeminiError> {
  const err = await readErrorBody(res);
  const detail = summarise(err.message, `HTTP ${res.status}`);
  switch (res.status) {
    case 400:
      return new GeminiError("invalid_key", 401, detail);
    case 401:
      // AQ keys authenticate as service-account tokens: a truncated or forged
      // AQ key lands here with ACCESS_TOKEN_TYPE_UNSUPPORTED, which reads like
      // an OAuth problem but is a broken key string. An AIza key sent as
      // Bearer also lands here; we never send Bearer, so 401 means bad key.
      return new GeminiError("invalid_key", 401, detail);
    case 403:
      // Key is valid but restricted in AI Studio to something other than the
      // Gemini API, or blocked at project level.
      return new GeminiError("key_restricted", 403, detail);
    case 404:
      // Every candidate in the chain is retired. Needs a code update, not a
      // new key, so it must not read like the user's fault.
      return new GeminiError("model_unavailable", 404, detail);
    case 429:
      return new GeminiError("quota_exceeded", 429, detail);
    case 503:
      return new GeminiError("model_overloaded", 503, detail);
    default:
      return new GeminiError("gemini_error", res.status, detail);
  }
}

/**
 * Minimal Gemini REST call (no SDK). JSON-mode via responseSchema.
 * Throws GeminiError on any failure; callers must fall back gracefully
 * (regex parser / templated copy).
 */
export async function geminiJson<T>(opts: {
  apiKey: string;
  prompt: string;
  schema: Record<string, unknown>;
}): Promise<T> {
  let res: Response;
  try {
    res = await callChain(opts.apiKey, {
      contents: [{ parts: [{ text: opts.prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: opts.schema,
        temperature: 0.4,
      },
    });
  } catch {
    throw new GeminiError("network_error", 503);
  }
  if (!res.ok) throw await toGeminiError(res);
  const data = await res.json();
  const text: string | undefined = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new GeminiError("empty_response", 502);
  return JSON.parse(text) as T;
}

export type KeyCheck = { ok: true; clean: string } | { ok: false; message: string };

/**
 * Validation ping used during key setup. Shape checks run first, because the
 * dominant real-world AQ failure is a copy-paste truncation that Google
 * reports as a misleading 401 "Expected OAuth 2 access token". Failures carry
 * Google's status and message so the actual cause is visible rather than
 * hidden behind "did not respond". Returns the cleaned key, so storage never
 * holds paste damage.
 */
export async function validateKey(raw: string): Promise<KeyCheck> {
  const key = cleanKeyInput(raw);

  if (!key) {
    return { ok: false, message: "That field is empty. Paste the key exactly as AI Studio shows it." };
  }

  const isLegacy = key.startsWith("AIza");
  const isAuth = key.startsWith("AQ.");
  if (!isLegacy && !isAuth) {
    return {
      ok: false,
      message:
        "That doesn't look like a Gemini API key. New keys start with AQ. and older ones with AIza.",
    };
  }
  if (isAuth && key.length < 40) {
    return {
      ok: false,
      message:
        "The key looks cut off. AQ keys are long, so copy the whole thing from AI Studio and paste it again.",
    };
  }

  let res: Response;
  try {
    res = await callChain(key, { contents: [{ parts: [{ text: "ping" }] }] });
  } catch {
    return { ok: false, message: "Couldn't reach Google from this server. Check the connection and try again." };
  }

  if (res.ok) return { ok: true, clean: key };

  const err = await readErrorBody(res);
  const detail = summarise(err.message, "no details sent");
  const code = res.status;

  // Every branch below keeps the HTTP code visible so a failure is
  // diagnosable, while the wording stays in the app's voice. Google's own
  // text is developer jargon, so it goes to the server log instead of the
  // screen, except for codes we have no sentence for.
  if (code !== 503) {
    console.warn(`[gemini] key check failed status=${code} status_text=${err.status ?? "-"} detail=${detail}`);
  }

  if (code === 503) {
    // The request authenticated and the model is out of capacity, which is
    // proof the key itself is fine. Never block a user on Google's load.
    return { ok: true, clean: key };
  }
  if (code === 429) {
    return { ok: false, message: "The key works, but its quota is used up right now (429)." };
  }
  if (code === 403) {
    return {
      ok: false,
      message: "This key is restricted and can't reach the Gemini API (403). In AI Studio, restrict it to the Gemini API, or make a fresh key.",
    };
  }
  if (code === 401 || code === 400) {
    return {
      ok: false,
      message: isAuth
        ? `Google rejected this key (${code}). Usually that means it got shortened while copying. Paste the full key from AI Studio once more.`
        : `Google rejected this key (${code}). It may have been revoked. Create a new one in AI Studio and paste it here.`,
    };
  }
  return { ok: false, message: `Google returned ${code}. ${detail}` };
}
