import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/requireUser";
import { getStore } from "@/lib/store";
import { encryptSecret } from "@/lib/auth/crypto";
import { validateKey } from "@/lib/ai/gemini";

export async function POST(req: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json()) as {
    monthlyIncome?: number;
    hardSavingsGoal?: number;
    fixedCosts?: { name: string; amount: number }[];
    categories?: { name: string; monthlyCap: number }[];
    geminiApiKey?: string;
    reminderHour?: number;
  };

  const store = getStore();
  const patch: Record<string, unknown> = {};

  if (body.monthlyIncome !== undefined) patch.monthlyIncome = body.monthlyIncome;
  if (body.hardSavingsGoal !== undefined) patch.hardSavingsGoal = body.hardSavingsGoal;
  if (body.reminderHour !== undefined) patch.reminderHour = body.reminderHour;

  if (body.geminiApiKey !== undefined) {
    const check = await validateKey(body.geminiApiKey);
    if (!check.ok) return NextResponse.json({ error: check.message }, { status: 400 });
    patch.geminiApiKeyEnc = encryptSecret(check.clean);
  }

  if (Object.keys(patch).length) await store.updateUser(user.id, patch);

  if (body.fixedCosts) {
    let sort = 0;
    for (const c of body.fixedCosts) {
      await store.upsertCategory(user.id, { name: c.name, monthlyCap: c.amount, flexible: false, sort: sort++ });
    }
  }
  if (body.categories) {
    let sort = 10;
    for (const c of body.categories) {
      await store.upsertCategory(user.id, { name: c.name, monthlyCap: c.monthlyCap, flexible: true, sort: sort++ });
    }
  }

  await store.updateUser(user.id, { onboardingDone: true });
  return NextResponse.json({ ok: true });
}
