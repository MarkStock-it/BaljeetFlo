import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/requireUser";
import { getStore } from "@/lib/store";
import { getUserApiKey } from "@/lib/ai/route-helpers";

/** GET: is a Gemini key configured? Decryptable counts as configured. */
export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!user.geminiApiKeyEnc) {
    return NextResponse.json({ configured: false, verified: false });
  }
  const key = await getUserApiKey(user);
  if (!key) {
    // Stored but undecryptable: DATA_ENC_KEY changed? Treat as broken.
    return NextResponse.json({ configured: false, verified: false, broken: true });
  }
  return NextResponse.json({ configured: true, verified: true });
}

/** DELETE: remove the stored key (user replaces or revokes it). */
export async function DELETE() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await getStore().updateUser(user.id, { geminiApiKeyEnc: null });
  return NextResponse.json({ ok: true });
}
