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
import { dayKey } from "@/lib/day";
import { addMonths, monthsBetween, planProjection } from "@/lib/engine/plans";
import { parseScheduleIntent, type ScheduleIntent } from "@/lib/engine/schedule-intent";
import type { PlanRow } from "@/lib/store/types";
import { safeUuid } from "@/lib/uuid";

export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await getStore().listChatMessages(user.id, 100);
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

export async function POST(req: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { message } = (await req.json()) as { message: string };
  if (!message?.trim()) return NextResponse.json({ error: "Empty message" }, { status: 400 });

  const store = getStore();
  const state = await buildBudgetState(user.id);
  const apiKey = await getUserApiKey(user);

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

  await store.addChatMessage({
    id: safeUuid(),
    userId: user.id,
    role: "user",
    kind: "text",
    payload: { text: message },
    createdAt: new Date(),
  });

  let draft: TxDraft | null = null;
  let usedFallback = false;

  if (apiKey) {
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
    } catch (e) {
      if (!(e instanceof GeminiError)) throw e;
      // Invalid key, quota, network: fall through to the regex parser.
    }
  }
  if (!draft) {
    draft = parseFallback(message);
    usedFallback = true;
  }
  if (!draft || draft.amount <= 0) {
    return coachReply(store, user.id, message, state, apiKey);
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

  await store.addChatMessage({
    id: safeUuid(),
    userId: user.id,
    role: "assistant",
    kind: "text",
    payload: { text: reply },
    createdAt: new Date(),
  });

  return NextResponse.json({ reply, cards, usedFallbackParser: usedFallback });
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
