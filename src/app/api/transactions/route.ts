import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/requireUser";
import { getStore } from "@/lib/store";
import { buildBudgetState } from "@/lib/ai/route-helpers";
import { calculateSafeToSpend } from "@/lib/engine/budget";

export async function GET(req: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const p = (k: string) => url.searchParams.get(k);
  const filters = {
    categoryId: p("categoryId") ?? undefined,
    from: p("from") ? new Date(p("from")!) : undefined,
    to: p("to") ? new Date(p("to")!) : undefined,
    min: p("min") ? Number(p("min")) : undefined,
    max: p("max") ? Number(p("max")) : undefined,
    refunded: p("refunded") === "true" ? true : p("refunded") === "false" ? false : undefined,
    page: Number(p("page") ?? 0),
    pageSize: Math.min(50, Number(p("pageSize") ?? 30)),
  };
  const { rows, total } = await getStore().listTransactions(user.id, filters);
  return NextResponse.json({
    total,
    rows: rows.map((t) => ({
      id: t.id,
      categoryId: t.categoryId,
      amount: t.amount,
      vendor: t.vendor,
      note: t.note,
      source: t.source,
      // Set when a schedule posted this. History uses it to offer "remove".
      recurringId: t.recurringId ?? null,
      spentAt: t.spentAt,
      stsBefore: t.stsBefore,
      stsAfter: t.stsAfter,
      flagged: t.flagged,
      refundedFrom: t.refundedFrom,
    })),
  });
}

export async function POST(req: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json()) as {
    action: "refund" | "correctCategory";
    txId: string;
    categoryId?: string;
  };
  const store = getStore();
  const tx = await store.getTransaction(body.txId);
  if (!tx || tx.userId !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (body.action === "correctCategory" && body.categoryId) {
    await store.updateTransaction(body.txId, { categoryId: body.categoryId, flagged: false });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "refund") {
    // One refund per transaction: check the ledger before writing.
    const { rows: existing } = await store.listTransactions(user.id, {
      page: 0,
      pageSize: 1000,
    });
    if (existing.some((t) => t.refundedFrom === tx.id)) {
      return NextResponse.json({ error: "This was already refunded" }, { status: 409 });
    }
    if (tx.amount < 0) {
      return NextResponse.json({ error: "Refunds can't be refunded" }, { status: 400 });
    }

    const state = await buildBudgetState(user.id);
    const before = calculateSafeToSpend(state);
    await store.addTransaction({
      id: globalThis.crypto.randomUUID(),
      userId: user.id,
      categoryId: tx.categoryId,
      amount: -Math.abs(tx.amount),
      vendor: tx.vendor,
      note: `Refund: ${tx.note ?? tx.vendor ?? "purchase"}`,
      source: "chat",
      rawInput: null,
      spentAt: new Date(),
      stsBefore: before,
      stsAfter: before + Math.abs(tx.amount),
      flagged: false,
      refundedFrom: tx.id,
    });
    return NextResponse.json({ ok: true, stsAfter: before + Math.abs(tx.amount) });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
