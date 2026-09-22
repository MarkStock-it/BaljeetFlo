const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export class GeminiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/**
 * Auth: every call sends the key in the x-goog-api-key header.
 *
 * Google is migrating keys from standard (AIza...) to authorization keys
 * (AQ....), bound to a service account. Both types authenticate the native
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

/**
 * Minimal Gemini REST call (no SDK). JSON-mode via responseSchema.
 * Throws GeminiError with status 401 (bad key), 429 (quota) or 403
 * (restricted key). Callers must fall back gracefully (regex parser /
 * templated copy).
 */
export async function geminiJson<T>(opts: {
  apiKey: string;
  prompt: string;
  schema: Record<string, unknown>;
  model?: string;
}): Promise<T> {
  const model = opts.model ?? "gemini-2.0-flash";
  let res: Response;
  try {
    res = await fetch(`${BASE}/${model}:generateContent`, {
      method: "POST",
      headers: authHeaders(opts.apiKey),
      body: JSON.stringify({
        contents: [{ parts: [{ text: opts.prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: opts.schema,
          temperature: 0.4,
        },
      }),
    });
  } catch {
    throw new GeminiError("network_error", 503);
  }
  if (res.status === 400) throw new GeminiError("invalid_key", 401);
  if (res.status === 401) {
    // AQ keys authenticate as service-account tokens: a truncated or forged
    // AQ key lands here with ACCESS_TOKEN_TYPE_UNSUPPORTED, which reads like
    // an OAuth problem but is a broken key string. An AIza key sent as Bearer
    // also lands here; we never send Bearer, so for us 401 means bad key.
    throw new GeminiError("invalid_key", 401);
  }
  if (res.status === 403) {
    // Key is valid but restricted in AI Studio to something other than the
    // Gemini API (or project-level blocked). Distinct from a bad key.
    throw new GeminiError("key_restricted", 403);
  }
  if (res.status === 429) throw new GeminiError("quota_exceeded", 429);
  if (!res.ok) throw new GeminiError("gemini_error", res.status);
  const data = await res.json();
  const text: string | undefined = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new GeminiError("empty_response", 502);
  return JSON.parse(text) as T;
}

export type KeyCheck =
  | { ok: true; clean: string }
  | { ok: false; message: string };

/**
 * Validation ping used during key setup. Checks shape first (the dominant
 * real-world AQ failure is a copy-paste truncation, which the API reports as
 * a misleading 401 "Expected OAuth 2 access token"), then does one cheap
 * round trip. Returns the cleaned key so storage never holds paste damage.
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

  try {
    const res = await fetch(`${BASE}/gemini-2.0-flash`, {
      method: "POST",
      headers: authHeaders(key),
      body: JSON.stringify({ contents: [{ parts: [{ text: "ping" }] }] }),
    });
    if (res.ok) return { ok: true, clean: key };
    if (res.status === 429) {
      return {
        ok: false,
        message: "The key is valid but its quota is used up. Try again after the quota resets.",
      };
    }
    if (res.status === 403) {
      return {
        ok: false,
        message:
          "This key is restricted and can't reach the Gemini API. In AI Studio, restrict it to the Gemini API, or create a fresh key.",
      };
    }
    if (res.status === 401 || res.status === 400) {
      return {
        ok: false,
        message: isAuth
          ? "Google rejected this key. Usually that means it got shortened while copying. Paste the full key from AI Studio once more."
          : "Google rejected this key. It may have been revoked. Create a new one in AI Studio and paste it here.",
      };
    }
    return { ok: false, message: "Google didn't respond as expected. Try once more in a minute." };
  } catch {
    return { ok: false, message: "Couldn't reach Google. Check your connection and try again." };
  }
}
