import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/requireUser";
import { getUserApiKey, buildBudgetState, fmt } from "@/lib/ai/route-helpers";
import { RECEIPT_VISION_PROMPT } from "@/lib/ai/prompts";

import { calculateSafeToSpend } from "@/lib/engine/budget";
import { getStore } from "@/lib/store";

const uuid = () => globalThis.crypto.randomUUID();

type ReceiptDraft = {
  vendor?: string;
  items?: { note: string; amount: number }[];
  total?: number;
  categoryIdGuess?: string;
  confidence?: number;
  error?: string;
};

/** POST { imageBase64, mime } → draft (NOT committed; user must approve). */
export async function POST(req: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { imageBase64, mime } = (await req.json()) as { imageBase64: string; mime: string };

  const apiKey = await getUserApiKey(user);
  if (!apiKey) {
    return NextResponse.json(
      { error: "No Gemini key configured. Add it in Setup, or type the expense in chat." },
      { status: 400 }
    );
  }

  const state = await buildBudgetState(user.id);
  let draft: ReceiptDraft;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: RECEIPT_VISION_PROMPT },
                { inlineData: { mimeType: mime || "image/jpeg", data: imageBase64 } },
              ],
            },
          ],
          generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
        }),
      }
    );
    if (!res.ok) throw new Error(`status_${res.status}`);
    const data = await res.json();
    draft = JSON.parse(data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}") as ReceiptDraft;
  } catch {
    return NextResponse.json(
      { error: "We couldn't read that receipt. What did you spend? (chat fallback)" },
      { status: 422 }
    );
  }

  if (draft.error || !draft.total) {
    return NextResponse.json(
      { error: "We couldn't read that receipt. What did you spend? (chat fallback)" },
      { status: 422 }
    );
  }

  return NextResponse.json({
    draft: {
      ...draft,
      categoryId: draft.categoryIdGuess && state.categories.some((c) => c.id === draft.categoryIdGuess)
        ? draft.categoryIdGuess
        : null,
    },
  });
}

/** PUT { draft, categoryId? }: user approved; commit all line items. */
export async function PUT(req: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { draft, categoryId } = (await req.json()) as {
    draft: ReceiptDraft & { categoryId?: string | null };
    categoryId?: string;
  };

  const store = getStore();
  const state = await buildBudgetState(user.id);
  const catId = categoryId ?? draft.categoryId ?? null;
  const committed: string[] = [];

  for (const item of draft.items ?? [{ note: draft.vendor ?? "Receipt total", amount: draft.total ?? 0 }]) {
    const before = calculateSafeToSpend(state);
    const id = uuid();
    await store.addTransaction({
      id, userId: user.id, categoryId: catId,
      amount: item.amount, vendor: draft.vendor ?? null,
      note: item.note, source: "receipt", rawInput: JSON.stringify(draft),
      spentAt: new Date(), stsBefore: before,
      stsAfter: Math.max(0, before - item.amount), flagged: false, refundedFrom: null,
    });
    committed.push(id);
  }

  const after = Math.max(0, calculateSafeToSpend(state) - (draft.total ?? 0));
  await store.addChatMessage({
    id: uuid(), userId: user.id, role: "assistant", kind: "receipt_draft",
    payload: {
      text: `Receipt approved. ${fmt(draft.total ?? 0)} at ${draft.vendor ?? "unknown"} logged as ${draft.items?.length ?? 1} line items. Safe-to-Spend: ${fmt(after)}.`,
    },
    createdAt: new Date(),
  });

  return NextResponse.json({ ok: true, committed, stsAfter: after });
}
