import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/requireUser";
import { getStore } from "@/lib/store";
import { getUserApiKey, buildBudgetState, fmt } from "@/lib/ai/route-helpers";
import { PARSE_TRANSACTION_PROMPT, COACH_PERSONA_PROMPT } from "@/lib/ai/prompts";
import { geminiJson, GeminiError } from "@/lib/ai/gemini";
import {
  calculateSafeToSpend,
  computeTradeOff,
  remaining,
  type BudgetState,
  type TxDraft,
} from "@/lib/engine/budget";
import { parseFallback } from "@/lib/engine/parse";
import { readLocally } from "@/lib/engine/local-parse";
import { dayKey } from "@/lib/day";
import { addMonths, monthsBetween, planProjection } from "@/lib/engine/plans";
import { parseScheduleIntent, type ScheduleIntent } from "@/lib/engine/schedule-intent";
import type { PlanRow } from "@/lib/store/types";
import { safeUuid } from "@/lib/uuid";

export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = collapseSupersededRedoRows(await getStore().listChatMessages(user.id, 100));
  return NextResponse.json({
    messages: rows.map((m) => ({
      id: m.id,
      role: m.role,
      kind: m.kind,
      payload: m.payload,
      createdAt: m.createdAt,
    })),
  });
}

/**
 * Older redo requests briefly wrote a second user bubble and a second answer.
 * Keep the transcript honest when those rows already exist: a correction is
 * one user line with the latest answer, not a second spend.
 */
function collapseSupersededRedoRows<T extends { role: "user" | "assistant"; payload: unknown }>(rows: T[]): T[] {
  const out: T[] = [];
  let i = 0;
  while (i < rows.length) {
    const row = rows[i];
    if (row.role !== "user") {
      out.push(row);
      i += 1;
      continue;
    }

    const text = (row.payload as { text?: unknown } | null)?.text;
    let j = i + 1;
    let latestAssistant: T | null = null;
    let repeated = false;
    while (j < rows.length && rows[j].role === "assistant") {
      const assistantText = (rows[j].payload as { text?: unknown } | null)?.text;
      if (typeof assistantText === "string" && assistantText.startsWith("My read was ")) {
        latestAssistant = rows[j];
      }
      j += 1;
    }
    while (j < rows.length && rows[j].role === "user") {
      const nextText = (rows[j].payload as { text?: unknown } | null)?.text;
      if (nextText !== text) break;
      repeated = true;
      j += 1;
      while (j < rows.length && rows[j].role === "assistant") {
        const assistantText = (rows[j].payload as { text?: unknown } | null)?.text;
        if (typeof assistantText === "string" && assistantText.startsWith("My read was ")) {
          latestAssistant = rows[j];
        }
        j += 1;
      }
    }

    out.push(row);
    if (repeated && latestAssistant) out.push(latestAssistant);
    else out.push(...rows.slice(i + 1, j));
    i = j;
  }
  return out;
}

export async function POST(req: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { message, redoTxId } = (await req.json()) as { message: string; redoTxId?: string };
  if (!message?.trim()) return NextResponse.json({ error: "Empty message" }, { status: 400 });

  const store = getStore();
  const state = await buildBudgetState(user.id);
  const apiKey = await getUserApiKey(user);

  // "Incorrect assumption" sends the same message back with the transaction it
  // mis-read. A redo never writes a second transaction: the spend happened once.
  const redoRow = redoTxId ? await store.getTransaction(redoTxId) : null;
  const redoing = redoRow && redoRow.userId === user.id ? redoRow : null;

  // "Can I afford X?" is a question, not a log. Answer with the consequence.
  const wantsAdvice = /\b(can i afford|should i buy|can i buy|is it ok if i (buy|spend))\b/i.test(message);
  if (wantsAdvice) {
    return answerAffordability(store, user.id, message, state, apiKey);
  }

  // "I'm saving up for a laptop, 45,000 by March" is a goal, not a spend.
  const planIntent = detectPlanIntent(message);
  if (planIntent) {
    return offerPlan(store, user.id, message, planIntent);
  }

  // "I pay 100 for transport every Mon, Wed and Fri" is money on a rhythm, not
  // a spend, and logging it as one would be wrong seventeen times a month.
  const scheduleIntent = parseScheduleIntent(message);
  if (scheduleIntent) {
    return offerSchedule(store, user.id, message, state, scheduleIntent);
  }

  let draft: TxDraft | null = null;
  let usedFallback = false;
  /** Where this reading came from, so the UI can offer a correction. */
  let source: "local" | "ai" | "fallback" = "fallback";

  // Local first. A confident keyword read is logged without asking Google, so
  // the common "coffee 130" case is instant. Everything else goes to the model.
  // A redo always goes to the model: the whole point is a second opinion.
  const local = readLocally(message, state.categories);
  if (local?.confident && !redoing) {
    draft = { ...local.draft, categoryId: local.categoryId, confidence: 0.9 };
    source = "local";
  } else if (apiKey) {
    try {
      draft = await geminiJson<TxDraft>({
        apiKey,
        prompt: `${PARSE_TRANSACTION_PROMPT}\n\nCategories (id: name):\n${state.categories
          .map((c) => `${c.id}: ${c.name}`)
          .join("\n")}\n\nMessage: ${JSON.stringify(message)}`,
        schema: {
          type: "object",
          properties: {
            amount: { type: "number" },
            vendor: { type: "string" },
            note: { type: "string" },
            categoryId: { type: "string" },
            confidence: { type: "number" },
            refund: { type: "boolean" },
          },
          required: ["amount"],
        },
      });
      if (draft) source = "ai";
    } catch (e) {
      if (!(e instanceof GeminiError)) throw e;
      // Invalid key, quota, network: fall through to the regex parser.
    }
  }
  if (!draft) {
    draft = parseFallback(message);
    usedFallback = true;
    source = "fallback";
  }
  if (!draft || draft.amount <= 0) {
    return coachReply(store, user.id, message, state, apiKey);
  }

  // Only a first reading lands in the transcript. A redo is a correction of an
  // existing line, not a second utterance.
  if (!redoing) {
    await store.addChatMessage({
      id: safeUuid(),
      userId: user.id,
      role: "user",
      kind: "text",
      payload: { text: message },
      createdAt: new Date(),
    });
  }

  if (redoing) {
    return await redoReading({
      store,
      userId: user.id,
      tx: redoing,
      draft,
      message,
      apiKey,
      state,
    });
  }

  // Refund path: money back, Safe-to-Spend rises immediately.
  if (draft.refund) {
    const categoryId = draft.categoryId ?? guessCategory(state, message);
    const before = calculateSafeToSpend(state);
    const tx = {
      id: safeUuid(),
      userId: user.id,
      categoryId,
      amount: -draft.amount,
      vendor: draft.vendor ?? null,
      note: draft.note ?? message.slice(0, 280),
      source: "chat" as const,
      rawInput: message,
      spentAt: new Date(),
      stsBefore: before,
      stsAfter: before + draft.amount,
      flagged: false,
      refundedFrom: null,
    };
    await store.addTransaction(tx);
    await store.addChatMessage({
      id: safeUuid(),
      userId: user.id,
      role: "assistant",
      kind: "log_card",
      payload: { text: `Refund logged: ${fmt(draft.amount)} back.`, txId: tx.id, before, after: tx.stsAfter },
      createdAt: new Date(),
    });
    return NextResponse.json({
      reply: `${fmt(draft.amount)} back in your budget. Safe-to-Spend is ${fmt(tx.stsAfter)}.`,
      cards: [{ type: "log_card", txId: tx.id, before, after: tx.stsAfter, refund: true }],
    });
  }

  // Spend path.
  let categoryId = draft.categoryId;
  if (!categoryId || !state.categories.some((c) => c.id === categoryId && c.flexible)) {
    categoryId = guessCategory(state, message);
  }
  if (!categoryId) {
    return NextResponse.json({
      reply: "I need at least one flexible category before I can log spending. Set them up in onboarding.",
    });
  }

  const plan = computeTradeOff(state.categories, categoryId, draft.amount);
  const before = calculateSafeToSpend(state);
  const tx = {
    id: safeUuid(),
    userId: user.id,
    categoryId,
    amount: draft.amount,
    vendor: draft.vendor ?? null,
    note: draft.note ?? message.slice(0, 280),
    source: "chat" as const,
    rawInput: message,
    spentAt: new Date(),
    stsBefore: before,
    stsAfter: Math.max(0, before - draft.amount),
    flagged: (draft.confidence ?? 1) < 0.7,
    refundedFrom: null,
  };
  await store.addTransaction(tx);

  // Day stat for the streak: within budget only if today's total spending
  // stayed at or under today's Safe-to-Spend target *before* this transaction.
  const day = dayKey();
  await store.upsertDayStat({
    userId: user.id,
    day,
    spent: state.spentToday + draft.amount,
    stsTarget: Math.round(before * 100) / 100,
    withinBudget: state.spentToday + draft.amount <= before,
  });

  const cards: unknown[] = [
    { type: "log_card", txId: tx.id, before, after: tx.stsAfter, amount: draft.amount },
  ];

  const cat = state.categories.find((c) => c.id === categoryId);

  // A local read is an assumption the app made without asking the model. The
  // user gets one tap to send it back for a second opinion.
  const assumption =
    source === "local" && cat ? { assumed: cat.name, original: message } : null;

  let reply: string;

  if (plan.overshoot > 0) {
    // Persist the reallocation. This is what makes it zero-sum, not cosmetic.
    for (const move of plan.moves) {
      const donor = state.categories.find((c) => c.id === move.fromCategoryId);
      if (donor) {
        await store.updateCategoryCap(user.id, donor.id, Math.max(0, donor.monthlyCap - move.amount));
      }
    }
    await store.addTradeOff({
      id: safeUuid(),
      userId: user.id,
      transactionId: tx.id,
      overshoot: plan.overshoot,
      status: plan.partial ? "adjusted" : "auto",
      moves: plan.moves,
    });

    const moveText = plan.moves
      .map((m) => `${fmt(m.amount)} from ${state.categories.find((c) => c.id === m.fromCategoryId)?.name}`)
      .join(" and ");
    reply = plan.partial
      ? `${fmt(draft.amount)} logged under ${cat?.name}. It runs ${fmt(plan.overshoot)} past what the other categories can absorb, so your savings goal stays locked and the rest comes out of tomorrow's pace.`
      : `${cat?.name} is ${fmt(plan.overshoot)} over. I moved ${moveText} to cover it. Your savings goal wasn't touched.`;
    cards.push({
      type: "tradeoff_card",
      txId: tx.id,
      overshoot: plan.overshoot,
      partial: plan.partial,
      moves: plan.moves.map((m) => ({
        fromId: m.fromCategoryId,
        from: state.categories.find((c) => c.id === m.fromCategoryId)?.name,
        amount: m.amount,
      })),
      donorNames: state.categories
        .filter((c) => c.flexible && c.id !== categoryId)
        .map((c) => c.name),
    });
  } else {
    reply = `${fmt(draft.amount)} under ${cat?.name}. Safe-to-Spend is ${fmt(tx.stsAfter)}.`;
    if (tx.flagged && cat) {
      reply += ` I guessed the category. Tap below if it's wrong.`;
    } else if (source === "local" && cat) {
      reply += ` I read that locally, so it was instant.`;
    }
  }

  if (tx.flagged && cat) {
    const alt = state.categories.filter((c) => c.flexible && c.id !== categoryId).slice(0, 2);
    cards.push({
      type: "clarify_chip",
      txId: tx.id,
      current: cat.name,
      options: alt.map((c) => c.name),
    });
  }

  // Composed last so the correction button always sits directly under the
  // reply it questions, never above a trade-off card.
  if (assumption) {
    cards.push({ type: "assumption", ...assumption, txId: tx.id });
  }

  await store.addChatMessage({
    id: safeUuid(),
    userId: user.id,
    role: "assistant",
    kind: "text",
    // The assumption travels with the reply so the correction survives a
    // reload, the way plan and schedule drafts already do.
    payload: assumption
      ? { text: reply, cards, assumption: { ...assumption, type: "assumption", txId: tx.id } }
      : { text: reply, cards },
    createdAt: new Date(),
  });

  return NextResponse.json({ reply, cards, usedFallbackParser: usedFallback, source });
}

/**
 * Second opinion on a spend the local reader placed.
 *
 * The transaction is moved rather than duplicated, and if its new category no
 * longer covers it, the same zero-sum rebalance as a fresh log runs. The state
 * is rebuilt first so the amount is not counted twice.
 */
async function redoReading(opts: {
  store: ReturnType<typeof getStore>;
  userId: string;
  tx: { id: string; categoryId: string | null; amount: number; vendor: string | null };
  draft: TxDraft;
  message: string;
  apiKey: string | null;
  state: BudgetState;
}) {
  const { store, userId, tx, draft, message, apiKey, state } = opts;
  const wasName = state.categories.find((c) => c.id === tx.categoryId)?.name ?? "my first guess";

  // Without a key there is no second opinion to get. Offer the manual pick
  // instead of pretending, since the local read is all the app has.
  if (!apiKey) {
    const options = state.categories
      .filter((c) => c.flexible && c.id !== tx.categoryId)
      .slice(0, 2)
      .map((c) => c.name);
    return NextResponse.json({
      reply: `I read that as ${wasName}, and there's no AI key saved to check again. Which one was it?`,
      cards: [{ type: "clarify_chip", txId: tx.id, current: wasName, options }],
      source: "local",
    });
  }

  const modelPick =
    draft.categoryId && state.categories.some((c) => c.id === draft.categoryId && c.flexible)
      ? draft.categoryId
      : null;
  const nextId = modelPick ?? guessCategory(state, message);
  const nextName = state.categories.find((c) => c.id === nextId)?.name ?? wasName;

  /**
   * One utterance gets one answer. The superseded reply is dropped rather than
   * stacked, so a reload cannot resurface a correction button for a spend that
   * has already been questioned.
   */
  const dropSuperseded = async () => {
    const history = await store.listChatMessages(userId, 100);
    const stale = history.find(
      (m) => (m.payload as { assumption?: { txId?: string } } | null)?.assumption?.txId === tx.id
    );
    if (stale) await store.deleteChatMessage(stale.id);
  };

  if (nextId === tx.categoryId) {
    await store.updateTransaction(tx.id, { flagged: false });
    const reply = `I checked with Gemini and it reads that the same way: ${nextName}. Nothing moved, and Safe-to-Spend is still ${fmt(
      calculateSafeToSpend(state)
    )}.`;
    await dropSuperseded();
    await store.addChatMessage({
      id: safeUuid(),
      userId,
      role: "assistant",
      kind: "text",
      payload: { text: reply },
      createdAt: new Date(),
    });
    return NextResponse.json({ reply, cards: [], source: "ai" });
  }

  // Undo the reallocation the first reading applied before asking for a new
  // one. Without this the donors fund both trade-offs and the same peso leaves
  // the same category twice.
  const undone = await store.undoTradeOffs(tx.id);
  if (undone.length) {
    const restored = await buildBudgetState(userId);
    for (const move of undone) {
      const donor = restored.categories.find((c) => c.id === move.fromCategoryId);
      if (donor) {
        await store.updateCategoryCap(userId, donor.id, donor.monthlyCap + move.amount);
      }
    }
  }

  await store.updateTransaction(tx.id, {
    categoryId: nextId,
    flagged: false,
    vendor: draft.vendor ?? tx.vendor,
  });

  // Rebuild, then take this transaction back out of the new category's spend so
  // the trade-off is computed exactly as a fresh log would compute it.
  const after = await buildBudgetState(userId);
  const asIfFresh = after.categories.map((c) =>
    c.id === nextId ? { ...c, spent: c.spent - tx.amount } : c
  );
  const plan = computeTradeOff(asIfFresh, nextId, tx.amount);
  const cards: unknown[] = [];
  let consequence = "";

  if (plan.overshoot > 0) {
    for (const move of plan.moves) {
      const donor = asIfFresh.find((c) => c.id === move.fromCategoryId);
      if (donor) {
        await store.updateCategoryCap(userId, donor.id, Math.max(0, donor.monthlyCap - move.amount));
      }
    }
    await store.addTradeOff({
      id: safeUuid(),
      userId,
      transactionId: tx.id,
      overshoot: plan.overshoot,
      status: plan.partial ? "adjusted" : "auto",
      moves: plan.moves,
    });
    const moveText = plan.moves
      .map((m) => `${fmt(m.amount)} from ${asIfFresh.find((c) => c.id === m.fromCategoryId)?.name}`)
      .join(" and ");
    consequence = plan.partial
      ? ` ${nextName} sits ${fmt(plan.overshoot)} past what the others can absorb, so your savings goal stays locked and the rest comes out of tomorrow's pace.`
      : ` ${nextName} is ${fmt(plan.overshoot)} over, so I moved ${moveText}. Your savings goal wasn't touched.`;
    cards.push({
      type: "tradeoff_card",
      txId: tx.id,
      overshoot: plan.overshoot,
      partial: plan.partial,
      moves: plan.moves.map((m) => ({
        fromId: m.fromCategoryId,
        from: asIfFresh.find((c) => c.id === m.fromCategoryId)?.name,
        amount: m.amount,
      })),
      donorNames: asIfFresh.filter((c) => c.flexible && c.id !== nextId).map((c) => c.name),
    });
  }

  const reply = `My read was ${wasName}. Gemini reads it as ${nextName}, so I moved the ${fmt(
    tx.amount
  )} there.${consequence}`;

  await dropSuperseded();

  await store.addChatMessage({
    id: safeUuid(),
    userId,
    role: "assistant",
    kind: "text",
    payload: { text: reply },
    createdAt: new Date(),
  });

  return NextResponse.json({ reply, cards, source: "ai" });
}

function guessCategory(state: BudgetState, text: string): string {
  const flexible = state.categories.filter((c) => c.flexible);
  if (flexible.length === 0) return "";
  const lower = text.toLowerCase();
  const hit = flexible.find((c) => lower.includes(c.name.toLowerCase()));
  return (hit ?? flexible.reduce((a, b) => (remaining(a) >= remaining(b) ? a : b))).id;
}

async function answerAffordability(
  store: ReturnType<typeof getStore>,
  userId: string,
  message: string,
  state: BudgetState,
  apiKey: string | null
) {
  const sts = calculateSafeToSpend(state);
  const m = message.match(/\d+(?:\.\d{1,2})?/);
  const price = m ? parseFloat(m[0]) : null;

  // Plans are the honest brake: a purchase now is months added to a goal.
  const plans = (await store.listPlans(userId))
    .filter((p) => p.status === "active" && p.monthlySetAside > 0)
    .sort((a, b) => (planProjection(a).monthsToTarget ?? 999) - (planProjection(b).monthsToTarget ?? 999));
  const nearest = plans[0];
  const delayNote =
    price !== null && price > sts && nearest
      ? ` It also pushes ${nearest.name} back about ${Math.ceil(price / nearest.monthlySetAside)} month${
          Math.ceil(price / nearest.monthlySetAside) === 1 ? "" : "s"
        }.`
      : "";

  let reply: string;
  if (price !== null) {
    const after = Math.max(0, sts - price);
    reply =
      price <= sts
        ? `Yes. It takes today's Safe-to-Spend from ${fmt(sts)} to ${fmt(after)}.${
            nearest && Math.ceil(price / nearest.monthlySetAside) >= 3
              ? ` ${nearest.name} is unaffected. It's already reserved.`
              : ""
          } If that's worth it to you, buy it and log it here after.`
        : `That's ${fmt(price)} against ${fmt(sts)} of Safe-to-Spend. Buying it means pulling from other categories or eating into tomorrow's pace.${delayNote} Sleep on it, or log it and I'll rebalance.`;
  } else {
    reply = `Tell me the price and I'll run the numbers against today's ${fmt(sts)}.`;
  }

  // With a working key, let the persona soften the wording but keep the math.
  if (apiKey) {
    try {
      const res = await geminiJson<{ reply: string }>({
        apiKey,
        prompt: `${COACH_PERSONA_PROMPT}\n\nA deterministic engine already computed this answer. Keep its numbers exactly, keep it to two sentences, no moralizing.\n\nComputed answer: ${reply}\nUser message: ${JSON.stringify(message)}`,
        schema: { type: "object", properties: { reply: { type: "string" } }, required: ["reply"] },
      });
      reply = res.reply;
    } catch {
      // keep the deterministic reply
    }
  }

  await store.addChatMessage({
    id: safeUuid(),
    userId,
    role: "user",
    kind: "text",
    payload: { text: message },
    createdAt: new Date(),
  });
  await store.addChatMessage({
    id: safeUuid(),
    userId,
    role: "assistant",
    kind: "text",
    payload: { text: reply },
    createdAt: new Date(),
  });
  return NextResponse.json({ reply });
}

/**
 * "I'm saving for a laptop, 45,000 by March" → a plan draft the user can
 * accept in one tap. The write itself happens in Plans, where the funding
 * math is visible, and a chat message should never quietly re-shape the budget.
 */
async function offerPlan(
  store: ReturnType<typeof getStore>,
  userId: string,
  message: string,
  intent: { name: string; targetAmount: number; deadline: Date | null }
) {
  const now = new Date();
  const months = intent.deadline ? Math.max(1, monthsBetween(now, intent.deadline)) : 12;
  const suggestedMonthly = Math.ceil(intent.targetAmount / months);

  const when = intent.deadline
    ? intent.deadline.toLocaleDateString("en-PH", { month: "long", year: "numeric" })
    : "a year from now";
  const reply = `${intent.name}: ${fmt(intent.targetAmount)} by about ${when}. Setting aside ${fmt(
    suggestedMonthly
  )} a month gets you there. That money leaves your flexible pool, so you'll need to free it from a category. Want to set it up?`;

  await store.addChatMessage({
    id: safeUuid(),
    userId,
    role: "user",
    kind: "text",
    payload: { text: message },
    createdAt: new Date(),
  });
  const plan = {
    type: "plan_draft" as const,
    name: intent.name,
    targetAmount: intent.targetAmount,
    monthlySetAside: suggestedMonthly,
    deadline: intent.deadline ? dayKey(intent.deadline) : null,
  };

  await store.addChatMessage({
    id: safeUuid(),
    userId,
    role: "assistant",
    kind: "text",
    // Persisted with the draft so the button is still there after a reload.
    payload: { text: reply, plan },
    createdAt: new Date(),
  });

  return NextResponse.json({ reply, cards: [plan] });
}

/**
 * "I pay 100 for transport every Mon, Wed and Fri" → a schedule the user can
 * switch on with one tap.
 *
 * The chat never writes the schedule itself. The rhythm repeats, so the tap is
 * the consent, and Plans is where the days can be corrected.
 */
async function offerSchedule(
  store: ReturnType<typeof getStore>,
  userId: string,
  message: string,
  state: BudgetState,
  intent: ScheduleIntent
) {
  const categoryId = guessCategory(state, `${intent.name} ${message}`);
  const category = state.categories.find((c) => c.id === categoryId);
  const room = category ? category.monthlyCap : 0;

  const amount = fmt(intent.amount);
  const perMonth = fmt(intent.monthlyEstimate);
  // A rhythm that outgrows its category is worth saying out loud before the
  // user switches it on, since the pace would quietly absorb the difference.
  const tight =
    !intent.needsDays && category && intent.monthlyEstimate > room
      ? ` That's more than ${category.name} holds in a month, so the pace will have to absorb the rest. Pick a bigger category in Plans if you'd rather not.`
      : "";
  const reply = intent.needsDays
    ? `${intent.name}: ${amount} on the days you're in. Which ones? Tell me \"Mon, Wed and Fri\", or pick them in Plans and it will land on its own after that.`
    : `${intent.name}: ${amount} ${intent.when}, about ${perMonth} a month out of ${
        category ? `${category.name}'s ${fmt(room)}` : "a category"
      }. Switch it on and it posts on its own; any day you skip, you pull from History.${tight}`;

  await store.addChatMessage({
    id: safeUuid(),
    userId,
    role: "user",
    kind: "text",
    payload: { text: message },
    createdAt: new Date(),
  });

  const card = {
    type: "recurring_draft" as const,
    name: intent.name,
    amount: intent.amount,
    cadence: intent.cadence,
    weekdays: intent.weekdays,
    dayOfMonth: intent.dayOfMonth,
    categoryId,
    categoryName: category?.name ?? null,
    when: intent.when,
    monthlyEstimate: intent.monthlyEstimate,
    needsDays: intent.needsDays,
  };

  await store.addChatMessage({
    id: safeUuid(),
    userId,
    role: "assistant",
    kind: "text",
    // Persisted with the draft so the button survives a reload.
    payload: { text: reply, recurring: card },
    createdAt: new Date(),
  });

  return NextResponse.json({ reply, cards: [card] });
}

/** Deterministic goal-detection. No AI required, so it never misfires on cost. */
function detectPlanIntent(
  text: string
): { name: string; targetAmount: number; deadline: Date | null } | null {
  if (
    !/\b(saving up for|save up for|saving for|save for|plan(ning)? to (buy|get)|want to buy|goal is|target is)\b/i.test(
      text
    )
  ) {
    return null;
  }
  const deadline = parseDeadline(text);
  const cleaned = text
    .replace(/\bin\s+\d{1,2}\s+months?\b/i, " ")
    .replace(/\bby\s+[A-Za-z]{3,9}(\s+\d{4})?\b/i, " ");
  const parsed = parseFallback(cleaned);
  if (!parsed || parsed.amount <= 0) return null;

  const raw = cleaned.match(
    /(?:saving up for|save up for|saving for|save for|plan(?:ning)? to (?:buy|get)|want to buy|goal is|target is)\s+(?:a|an|the|my)?\s*([A-Za-z0-9'&\- ]{2,40})/i
  )?.[1];
  const name = (raw ?? "")
    .replace(/[\d.,]+\s*$/, "")
    .replace(/\s+(for|at|worth|costs?)\s*$/i, "")
    .replace(/[.,;]$/, "")
    .trim();

  return {
    name: name ? name[0].toUpperCase() + name.slice(1) : "New plan",
    targetAmount: parsed.amount,
    deadline,
  };
}

function parseDeadline(text: string): Date | null {
  const now = new Date();
  const inMonths = text.match(/\bin\s+(\d{1,2})\s+months?\b/i);
  if (inMonths) return addMonths(now, Math.max(1, Number(inMonths[1])));

  const byMonth = text.match(/\bby\s+([A-Za-z]{3,9})(?:\s+(\d{4}))?\b/i);
  if (!byMonth) return null;
  const months = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
  ];
  const needle = byMonth[1].toLowerCase();
  const idx = months.findIndex((m) => m.startsWith(needle.slice(0, 3)));
  if (idx < 0) return null;
  let year = byMonth[2] ? Number(byMonth[2]) : now.getFullYear();
  // Month already gone this year? Aim at next year instead of the past.
  if (!byMonth[2] && idx < now.getMonth()) year += 1;
  return new Date(year, idx + 1, 0); // last day of that month
}

async function coachReply(
  store: ReturnType<typeof getStore>,
  userId: string,
  message: string,
  state: BudgetState,
  apiKey: string | null
) {
  const sts = calculateSafeToSpend(state);
  let reply = plainCoach(message, sts);

  if (apiKey) {
    try {
      const plans = (await store.listPlans(userId)).filter((p) => p.status === "active");
      const planContext = plans.length
        ? `Plans: ${plans
            .map((p: PlanRow) => `${p.name} (${fmt(p.targetAmount)} target, ${fmt(p.monthlySetAside)}/mo set aside)`)
            .join("; ")}.`
        : "No plans set aside yet. If they mention something they want to buy, offer to make it a plan.";
      const recurring = (await store.listRecurring(userId)).filter((r) => r.active);
      const scheduleContext = recurring.length
        ? `Scheduled payments: ${recurring
            .map((r) => `${r.name} (${fmt(r.amount)})`)
            .join("; ")}. ${fmt(state.committedUpcoming ?? 0)} still to come this month.`
        : "Nothing is on a schedule yet. If they pay the same thing repeatedly, offer to set it up.";
      const res = await geminiJson<{ reply: string }>({
        apiKey,
        prompt: `${COACH_PERSONA_PROMPT}\n\nBudget state: Safe-to-Spend today ${fmt(sts)}; spent today ${fmt(state.spentToday)}; savings goal ${fmt(state.hardSavingsGoal)}. ${planContext} ${scheduleContext}\nUser: ${JSON.stringify(message)}`,
        schema: { type: "object", properties: { reply: { type: "string" } }, required: ["reply"] },
      });
      reply = res.reply;
    } catch {
      // keep deterministic reply
    }
  }

  await store.addChatMessage({
    id: safeUuid(),
    userId,
    role: "assistant",
    kind: "text",
    payload: { text: reply },
    createdAt: new Date(),
  });
  return NextResponse.json({ reply });
}

function plainCoach(message: string, sts: number): string {
  if (/\b(hi|hello|hey)\b/i.test(message) && message.length < 30) {
    return `Hey. Today's Safe-to-Spend is ${fmt(sts)}. Tell me what you spend as it happens and I'll keep the math honest.`;
  }
  if (/\b(help|how)\b/i.test(message)) {
    return `Talk to me like a person: "Spent 180 at Jollibee", "Got refunded 250 from Steam", or "Can I afford 150 shoes?" I'll handle the ledger.`;
  }
  return `Today's Safe-to-Spend is ${fmt(sts)}. Tell me what you spent and I'll log it, like "Spent 140 on groceries".`;
}
