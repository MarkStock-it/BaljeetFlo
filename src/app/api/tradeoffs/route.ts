import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/requireUser";
import { getStore } from "@/lib/store";
import { buildBudgetState, fmt } from "@/lib/ai/route-helpers";
import { remaining, type BudgetState } from "@/lib/engine/budget";
import { safeUuid } from "@/lib/uuid";

type Move = { fromCategoryId: string; amount: number };

/**
 * Adjust a trade-off: redistribute the pull across flexible categories.
 * The total pulled must equal the auto-plan's total (or the overshoot),
 * the user can move money around, never conjure it.
 */
export async function POST(req: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { txId, moves } = (await req.json()) as { txId: string; moves: Move[] };
  if (!txId || !Array.isArray(moves)) {
    return NextResponse.json({ error: "txId and moves are required" }, { status: 400 });
  }

  const store = getStore();
  const tx = await store.getTransaction(txId);
  if (!tx || tx.userId !== user.id) {
    return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
  }

  const state: BudgetState = await buildBudgetState(user.id);
  const overshoot = tx.amount - remainingAtLogTime(state, tx);

  // Total moved must cover the overshoot, no more, no less (1 centavo tolerance).
  const total = moves.reduce((s, m) => s + Number(m.amount || 0), 0);
  if (Math.abs(total - overshoot) > 0.01) {
    return NextResponse.json(
      { error: `Moves must total exactly ${fmt(overshoot)}, the overspent amount. You can't raise the total.` },
      { status: 400 }
    );
  }

  // Every source must be a flexible category with enough remaining.
  for (const m of moves) {
    const cat = state.categories.find((c) => c.id === m.fromCategoryId);
    if (!cat || !cat.flexible) {
      return NextResponse.json({ error: `Invalid source category` }, { status: 400 });
    }
    if (m.amount > remaining(cat) + 0.01) {
      return NextResponse.json(
        { error: `${cat.name} only has ${fmt(remaining(cat))} left` },
        { status: 400 }
      );
    }
  }

  // Persist.
  for (const m of moves) {
    const cat = state.categories.find((c) => c.id === m.fromCategoryId)!;
    await store.updateCategoryCap(user.id, m.fromCategoryId, Math.max(0, cat.monthlyCap - m.amount));
  }
  await store.addTradeOff({
    id: safeUuid(),
    userId: user.id,
    transactionId: txId,
    overshoot,
    status: "adjusted",
    moves,
  });

  return NextResponse.json({ ok: true, moved: total });
}

function remainingAtLogTime(state: BudgetState, tx: { categoryId: string | null; amount: number }) {
  const cat = state.categories.find((c) => c.id === tx.categoryId);
  if (!cat) return tx.amount; // category gone; treat as fully covered
  // remaining now already includes this transaction's spend, so add it back
  return Math.max(0, cat.monthlyCap - (cat.spent - tx.amount));
}
