import { NextResponse } from "next/server";
import { randomBytes, randomInt, timingSafeEqual } from "crypto";
import { requireUser } from "@/lib/auth/requireUser";
import { getStore } from "@/lib/store";
import { sha256 } from "@/lib/auth/crypto";
import { buildBudgetState, fmt } from "@/lib/ai/route-helpers";
import { calculateSafeToSpend } from "@/lib/engine/budget";
import { safeUuid } from "@/lib/uuid";

const attempts = new Map<string, { count: number; until: number }>();

/** POST (authed user): create view-only guardian link. Code shown once. */
export async function POST() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const token = randomBytes(24).toString("hex");
  const code = String(randomInt(100000, 999999));
  await getStore().createGuardianLink({
    id: safeUuid(),
    userId: user.id,
    tokenHash: sha256(token),
    secretCode: code,
  });
  return NextResponse.json({ url: `/guardian/${token}`, code });
}

/**
 * GET /api/guardian?token=...&code=...: public, view-only.
 * The code is required on first view (proves the parent got it from the user),
 * then remembered. Six wrong attempts locks the link for 15 minutes.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const code = url.searchParams.get("code") ?? "";
  if (!token) return NextResponse.json({ error: "Missing token" }, { status: 400 });

  const tokenHash = sha256(token);
  const store = getStore();
  const link = await store.getGuardianByToken(tokenHash);
  if (!link) return NextResponse.json({ error: "This link is not valid" }, { status: 404 });

  // Already redeemed: allow re-view without the code.
  if (!link.redeemed) {
    const rec = attempts.get(tokenHash) ?? { count: 0, until: 0 };
    if (Date.now() < rec.until) {
      return NextResponse.json(
        { error: "Too many wrong codes. Try again in 15 minutes." },
        { status: 429 }
      );
    }

    const expected = Buffer.from(link.secretCode);
    const given = Buffer.from(code);
    const ok =
      expected.length === given.length && timingSafeEqual(expected, given);
    if (!ok) {
      rec.count += 1;
      rec.until = rec.count >= 6 ? Date.now() + 15 * 60_000 : rec.until;
      attempts.set(tokenHash, rec);
      return NextResponse.json({ error: "That code doesn't match" }, { status: 401 });
    }
    attempts.delete(tokenHash);
    await store.markGuardianRedeemed(link.id);
  }

  const user = await store.getUserById(link.userId);
  const state = await buildBudgetState(link.userId);
  return NextResponse.json({
    viewOnly: true,
    username: user?.username,
    hardSavingsGoal: state.hardSavingsGoal,
    safeToSpend: fmt(calculateSafeToSpend(state)),
  });
}
