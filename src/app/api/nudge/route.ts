import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/requireUser";
import { getStore } from "@/lib/store";
import { buildBudgetState, fmt } from "@/lib/ai/route-helpers";
import { calculateSafeToSpend } from "@/lib/engine/budget";
import { getUserApiKey } from "@/lib/ai/route-helpers";
import { COACH_PERSONA_PROMPT } from "@/lib/ai/prompts";
import { geminiJson } from "@/lib/ai/gemini";
import { dayKey } from "@/lib/day";
import { safeUuid } from "@/lib/uuid";

/**
 * Evening check-in. Called by the client around the user's reminder hour
 * (and idempotent per day). Tone escalates after 3 silent days: always
 * supportive, offers a lump-sum catch-up, never nags.
 */
export async function POST() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const store = getStore();
  const today = dayKey();

  // Idempotent: only one nudge per local day.
  const existing = await store.listChatMessages(user.id, 30);
  const alreadyNudged = existing.some(
    (m) => m.kind === "nudge" && dayKey(new Date(m.createdAt)) === today
  );
  if (alreadyNudged) return NextResponse.json({ ok: true, skipped: true });

  const state = await buildBudgetState(user.id);
  const sts = calculateSafeToSpend(state);

  // How many days since the user last logged anything?
  const { rows } = await store.listTransactions(user.id, { page: 0, pageSize: 1 });
  const lastLogged = rows[0] ? new Date(rows[0].spentAt) : null;
  const daysSilent = lastLogged
    ? Math.floor((Date.now() - lastLogged.getTime()) / 86_400_000)
    : 7;

  let text: string;
  if (daysSilent >= 3) {
    text = `We haven't caught up in ${daysSilent} days, and I don't want to guess where your money went. If it's easier, tell me one lump number for everything and I'll sort it out. Today's Safe-to-Spend is ${fmt(sts)}.`;
  } else if (state.spentToday > 0) {
    text = `Before the day wraps: anything else to log? You're at ${fmt(state.spentToday)} so far today.`;
  } else {
    text = `Checking in before the day ends. Nothing logged today, which is a perfectly good answer. ${fmt(sts)} of Safe-to-Spend left for tomorrow.`;
  }

  // With a working key, let the persona reword it but keep the numbers.
  const apiKey = await getUserApiKey(user);
  if (apiKey) {
    try {
      const res = await geminiJson<{ reply: string }>({
        apiKey,
        prompt: `${COACH_PERSONA_PROMPT}\n\nA deterministic engine wrote this evening check-in. Keep its numbers exactly, keep it under two sentences, gently worried if it sounds worried, never nagging.\n\nDraft: ${text}`,
        schema: { type: "object", properties: { reply: { type: "string" } }, required: ["reply"] },
      });
      text = res.reply;
    } catch {
      // keep deterministic draft
    }
  }

  await store.addChatMessage({
    id: safeUuid(),
    userId: user.id,
    role: "assistant",
    kind: "nudge",
    payload: { text },
    createdAt: new Date(),
  });

  return NextResponse.json({ ok: true, text });
}
