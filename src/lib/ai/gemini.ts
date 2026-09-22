const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export class GeminiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/**
 * Minimal Gemini REST call (no SDK). JSON-mode via responseSchema.
 * Throws GeminiError with status 401 (bad key) or 429 (quota). Callers
 * must fall back gracefully (regex parser / templated copy).
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
    res = await fetch(`${BASE}/${model}:generateContent?key=${encodeURIComponent(opts.apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
  if (res.status === 403) throw new GeminiError("invalid_key", 401);
  if (res.status === 429) throw new GeminiError("quota_exceeded", 429);
  if (!res.ok) throw new GeminiError("gemini_error", res.status);
  const data = await res.json();
  const text: string | undefined = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new GeminiError("empty_response", 502);
  return JSON.parse(text) as T;
}

/** Validation ping used during onboarding key setup. */
export async function validateKey(apiKey: string): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/gemini-2.0-flash?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: "ping" }] }] }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
