import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/requireUser";
import { getStore } from "@/lib/store";
import { getUserApiKey } from "@/lib/ai/route-helpers";
import { WEEKLY_ANALYSIS_PROMPT } from "@/lib/ai/prompts";
import { geminiJson } from "@/lib/ai/gemini";
import { detectPatterns } from "@/lib/engine/patterns";
import { stackValue } from "@/lib/engine/stack";
import { planProjection, planSentence } from "@/lib/engine/plans";
import { dayKey } from "@/lib/day";

type WeekReport = { headline: string; observations: string[]; recommendations: string[] };

export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const store = getStore();

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const { rows } = await store.listTransactions(user.id, { from: monthStart, page: 0, pageSize: 1000 });
  const cats = await store.getCategories(user.id);
  const dayStats = await store.listDayStats(user.id, 60);

  const flexible = cats.filter((c) => c.flexible);
  const flexibleTotal = flexible.reduce((s, c) => s + c.monthlyCap, 0);
  const flexibleSpent = rows
    .filter((t) => t.amount > 0 && flexible.some((c) => c.id === t.categoryId))
    .reduce((s, t) => s + t.amount, 0);

  const plans = (await store.listPlans(user.id)).filter((p) => p.status !== "done");

  return NextResponse.json({
    stack: stackValue({ flexibleTotal, flexibleSpent, dayStats }),
    catNames: Object.fromEntries(cats.map((c) => [c.id, c.name])),
    heuristics: detectPatterns(
      rows.map((t) => ({ amount: t.amount, categoryId: t.categoryId, spentAt: t.spentAt.toISOString() })),
      Object.fromEntries(cats.map((c) => [c.id, c.name]))
    ),
    plans: plans.map((p) => {
      const projection = planProjection(p);
      return {
        id: p.id,
        name: p.name,
        targetAmount: p.targetAmount,
        monthlySetAside: p.monthlySetAside,
        status: p.status,
        projection,
        sentence: planSentence(p, projection),
      };
    }),
  });
}

/**
 * POST = "Analyze now" + the Sunday auto-delivery path (same code, idempotent).
 * Pass ?auto=1 to skip when a report for this calendar week already exists.
 */
export async function POST(req: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const store = getStore();
  const auto = new URL(req.url).searchParams.get("auto") === "1";

  if (auto) {
    // One report per calendar week (Sunday-dated), matching the locked spec.
    const weekKey = weekOf(new Date());
    const recent = await store.listChatMessages(user.id, 50);
    const already = recent.some(
      (m) =>
        m.kind === "week_report" &&
        m.payload &&
        typeof m.payload === "object" &&
        (m.payload as Record<string, unknown>).weekKey === weekKey
    );
    if (already) return NextResponse.json({ ok: true, skipped: true });
  }

  const apiKey = await getUserApiKey(user);

  const weekAgo = new Date(Date.now() - 7 * 86400_000);
  const { rows } = await store.listTransactions(user.id, { from: weekAgo, page: 0, pageSize: 500 });
  const cats = await store.getCategories(user.id);
  const catNames = Object.fromEntries(cats.map((c) => [c.id, c.name]));
  const heuristics = detectPatterns(
    rows.map((t) => ({ amount: t.amount, categoryId: t.categoryId, spentAt: t.spentAt.toISOString() })),
    catNames
  );

  const planLines = (await store.listPlans(user.id))
    .filter((p) => p.status !== "done")
    .map((p) => planSentence(p, planProjection(p)));

  let report: WeekReport | null = null;
  if (apiKey && rows.length > 0) {
    try {
      report = await geminiJson<WeekReport>({
        apiKey,
        prompt: `${WEEKLY_ANALYSIS_PROMPT}\n\nCategories: ${JSON.stringify(catNames)}\nHeuristic observations: ${JSON.stringify(heuristics)}\nPlans in progress: ${JSON.stringify(planLines)}\nTransactions: ${JSON.stringify(rows.map((t) => ({ amount: t.amount, categoryId: t.categoryId, vendor: t.vendor, note: t.note, spentAt: t.spentAt })))}`,
        schema: {
          type: "object",
          properties: {
            headline: { type: "string" },
            observations: { type: "array", items: { type: "string" } },
            recommendations: { type: "array", items: { type: "string" } },
          },
          required: ["headline", "observations", "recommendations"],
        },
      });
    } catch {
      report = null; // graceful fallback below
    }
  }
  if (!report) {
    report = {
      headline: rows.length ? "This week in numbers" : "A quiet week",
      observations: heuristics.map((h) => h.text).length
        ? heuristics.map((h) => h.text)
        : ["Not enough data yet. Keep logging and patterns will emerge."],
      recommendations: [
        planLines[0] ??
          "Ask me in chat before you spend, like \"Can I afford ₱500 this weekend?\"",
      ],
    };
  }

  await store.addChatMessage({
    id: globalThis.crypto.randomUUID(),
    userId: user.id,
    role: "assistant",
    kind: "week_report",
    payload: { ...report, weekKey: weekOf(new Date()) },
    createdAt: new Date(),
  });

  return NextResponse.json({ report });
}

/** Local Sunday that starts the user's week. The auto-report is keyed on it. */
function weekOf(d: Date): string {
  const local = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  local.setDate(local.getDate() - local.getDay());
  return dayKey(local);
}
