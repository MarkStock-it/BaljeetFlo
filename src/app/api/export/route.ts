import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { requireUser } from "@/lib/auth/requireUser";
import { getStore } from "@/lib/store";
import { buildBudgetState, toSchedule } from "@/lib/ai/route-helpers";
import { calculateSafeToSpend } from "@/lib/engine/budget";
import { reserveTotal } from "@/lib/engine/plans";
import { describeSchedule, nextOccurrence } from "@/lib/engine/recurring";
import { dayKey } from "@/lib/day";
import type { TxRow } from "@/lib/store/types";

// exceljs reaches for Node's zlib and streams, so this route belongs on the
// Node runtime rather than the edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACCENT = "FF0A84FF";
const INK = "FF1C1C1E";
const MUTED = "FF6E6E73";
const HAIRLINE = "FFE4E4E9";
const ZEBRA = "FFF7F8FA";
/** Excel number format: a real number the spreadsheet can sum, shown in pesos. */
const PESO = '"₱"#,##0.00';
const STAMP = "yyyy-mm-dd hh:mm";

const round2 = (n: number) => Math.round(n * 100) / 100;
const ink = { argb: INK };
const muted = { argb: MUTED };

/**
 * Everything a user has ever put into BudgetFlow, as one formatted workbook.
 *
 * The money stays numeric with a currency format rather than being pre-formatted
 * into strings, so the sheet can be summed, sorted and charted the moment it
 * opens. Refunds are negative amounts, which is what makes a column total equal
 * the real net spend.
 */
export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const store = getStore();
  const state = await buildBudgetState(user.id);
  const soonest = calculateSafeToSpend(state);

  // Page through the whole ledger: an export that silently stops at the first
  // thousand rows would be worse than no export at all.
  const txs: TxRow[] = [];
  for (let page = 0; page < 500; page += 1) {
    const { rows, total } = await store.listTransactions(user.id, { page, pageSize: 1000 });
    txs.push(...rows);
    if (rows.length === 0 || txs.length >= total) break;
  }
  txs.sort((a, b) => b.spentAt.getTime() - a.spentAt.getTime());

  const cats = await store.getCategories(user.id);
  const plans = await store.listPlans(user.id);
  const recurring = await store.listRecurring(user.id);
  const dayStats = await store.listDayStats(user.id, 90);

  const nameOf = new Map(cats.map((c) => [c.id, c.name]));
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthTx = txs.filter((t) => new Date(t.spentAt) >= monthStart);
  const monthSpend = round2(monthTx.reduce((s, t) => s + t.amount, 0));

  const fixedTotal = round2(cats.filter((c) => !c.flexible).reduce((s, c) => s + c.monthlyCap, 0));
  const flexiblePool = round2(cats.filter((c) => c.flexible).reduce((s, c) => s + c.monthlyCap, 0));

  const wb = new ExcelJS.Workbook();
  wb.creator = "BudgetFlow";
  wb.created = now;

  /* ── Summary ────────────────────────────────────────────────────────── */
  const summary = wb.addWorksheet("Summary");
  summary.columns = [
    { key: "label", width: 34 },
    { key: "value", width: 22 },
  ];

  const title = summary.addRow(["BudgetFlow export"]);
  summary.mergeCells(title.number, 1, title.number, 2);
  title.height = 28;
  title.getCell(1).font = { size: 16, bold: true, color: ink };

  const subtitle = summary.addRow([
    `${user.username} · ${now.toLocaleString("en-PH", { dateStyle: "long", timeStyle: "short" })}`,
  ]);
  summary.mergeCells(subtitle.number, 1, subtitle.number, 2);
  subtitle.getCell(1).font = { size: 10, color: muted };

  summary.addRow([]);
  const head = summary.addRow(["Metric", "Value"]);
  styleAsHeader(summary, head.number, 2);

  const metrics: [string, number, boolean][] = [
    ["Monthly income", state.income, true],
    ["Fixed costs", fixedTotal, true],
    ["Savings floor", state.hardSavingsGoal, true],
    ["Set aside for plans", reserveTotal(plans), true],
    ["Left to spend", flexiblePool, true],
    ["Safe to spend today", soonest, true],
    ["Spent today", state.spentToday, true],
    ["Spent this month", monthSpend, true],
    ["Transactions this month", monthTx.length, false],
    ["Transactions in this file", txs.length, false],
    ["Categories", cats.length, false],
    ["Plans", plans.length, false],
    ["Scheduled payments", recurring.filter((r) => r.active).length, false],
  ];
  for (const [label, value, isMoney] of metrics) {
    const row = summary.addRow([label, value]);
    row.getCell(1).font = { color: ink };
    const cell = row.getCell(2);
    cell.alignment = { horizontal: "right" };
    if (isMoney) cell.numFmt = PESO;
    cell.font = { color: ink, bold: true };
  }

  summary.addRow([]);
  const footnote = summary.addRow([
    "Amounts are in Philippine pesos. In the Transactions sheet a refund is a negative amount, so each column total is the real net spend.",
  ]);
  summary.mergeCells(footnote.number, 1, footnote.number, 2);
  footnote.getCell(1).font = { size: 10, color: muted };
  footnote.getCell(1).alignment = { wrapText: true, vertical: "top" };
  footnote.height = 30;

  /* ── Transactions ───────────────────────────────────────────────────── */
  const tx = wb.addWorksheet("Transactions");
  tx.columns = [
    { header: "Date", key: "date", width: 20 },
    { header: "Vendor", key: "vendor", width: 26 },
    { header: "Note", key: "note", width: 46 },
    { header: "Category", key: "category", width: 18 },
    { header: "Type", key: "type", width: 11 },
    { header: "Amount", key: "amount", width: 15 },
    { header: "Source", key: "source", width: 13 },
    { header: "Flagged", key: "flagged", width: 9 },
  ];
  styleAsHeader(tx, 1, 8);
  for (const t of txs) {
    tx.addRow({
      date: new Date(t.spentAt),
      vendor: t.vendor ?? "",
      note: t.note ?? "",
      category: t.categoryId ? nameOf.get(t.categoryId) ?? "Uncategorised" : "Uncategorised",
      type: t.amount < 0 || t.refundedFrom ? "Refund" : t.recurringId ? "Scheduled" : "Spend",
      amount: t.amount,
      source: t.source,
      flagged: t.flagged ? "Yes" : "",
    });
  }
  setColumnFormat(tx, "date", STAMP);
  setColumnFormat(tx, "amount", PESO);
  stripe(tx, 8);

  /* ── Budget ─────────────────────────────────────────────────────────── */
  const budget = wb.addWorksheet("Budget");
  budget.columns = [
    { header: "Category", key: "name", width: 26 },
    { header: "Type", key: "type", width: 12 },
    { header: "Monthly cap", key: "cap", width: 16 },
    { header: "Spent this month", key: "spent", width: 18 },
    { header: "Remaining", key: "left", width: 16 },
  ];
  styleAsHeader(budget, 1, 5);
  for (const c of state.categories) {
    budget.addRow({
      name: c.name,
      type: c.flexible ? "Flexible" : "Fixed",
      cap: c.monthlyCap,
      spent: round2(c.spent),
      // The raw difference, not the engine's clamped one: an overspent category
      // should read as negative here, not as a healthy zero.
      left: round2(c.monthlyCap - c.spent),
    });
  }
  setColumnFormat(budget, "cap", PESO);
  setColumnFormat(budget, "spent", PESO);
  setColumnFormat(budget, "left", PESO);
  stripe(budget, 5);

  /* ── Plans ──────────────────────────────────────────────────────────── */
  const planSheet = wb.addWorksheet("Plans");
  planSheet.columns = [
    { header: "Plan", key: "name", width: 28 },
    { header: "Target", key: "target", width: 16 },
    { header: "Saved so far", key: "saved", width: 16 },
    { header: "Monthly set aside", key: "monthly", width: 18 },
    { header: "Target date", key: "date", width: 16 },
    { header: "Status", key: "status", width: 12 },
    { header: "Progress", key: "progress", width: 12 },
  ];
  styleAsHeader(planSheet, 1, 7);
  for (const p of plans) {
    planSheet.addRow({
      name: p.name,
      target: p.targetAmount,
      saved: p.savedAmount,
      monthly: p.monthlySetAside,
      date: p.targetDate ? dayKey(new Date(p.targetDate)) : "",
      status: p.status,
      progress: p.targetAmount > 0 ? p.savedAmount / p.targetAmount : 0,
    });
  }
  setColumnFormat(planSheet, "target", PESO);
  setColumnFormat(planSheet, "saved", PESO);
  setColumnFormat(planSheet, "monthly", PESO);
  setColumnFormat(planSheet, "progress", "0%");
  stripe(planSheet, 7);

  /* ── Scheduled payments ─────────────────────────────────────────────── */
  const sched = wb.addWorksheet("Scheduled");
  sched.columns = [
    { header: "Name", key: "name", width: 26 },
    { header: "Category", key: "category", width: 18 },
    { header: "Amount", key: "amount", width: 15 },
    { header: "Rhythm", key: "rhythm", width: 30 },
    { header: "Next", key: "next", width: 14 },
    { header: "Active", key: "active", width: 10 },
  ];
  styleAsHeader(sched, 1, 6);
  for (const r of recurring) {
    const schedule = toSchedule(r);
    const next = nextOccurrence(schedule, now);
    sched.addRow({
      name: r.name,
      category: r.categoryId ? nameOf.get(r.categoryId) ?? "Uncategorised" : "Uncategorised",
      amount: r.amount,
      rhythm: describeSchedule(schedule),
      next: next ? dayKey(next) : "",
      active: r.active ? "Yes" : "No",
    });
  }
  setColumnFormat(sched, "amount", PESO);
  stripe(sched, 6);

  /* ── Daily pace ─────────────────────────────────────────────────────── */
  const daily = wb.addWorksheet("Daily pace");
  daily.columns = [
    { header: "Day", key: "day", width: 14 },
    { header: "Spent", key: "spent", width: 15 },
    { header: "Safe-to-spend target", key: "target", width: 21 },
    { header: "Within budget", key: "within", width: 15 },
  ];
  styleAsHeader(daily, 1, 4);
  for (const d of dayStats) {
    daily.addRow({
      day: d.day,
      spent: round2(d.spent),
      target: round2(d.stsTarget),
      within: d.withinBudget ? "Yes" : "No",
    });
  }
  setColumnFormat(daily, "spent", PESO);
  setColumnFormat(daily, "target", PESO);
  stripe(daily, 4);

  const bytes = new Uint8Array(await wb.xlsx.writeBuffer());
  const stamp = dayKey(now);
  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="budgetflow-${safeName(user.username)}-${stamp}.xlsx"`,
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "no-store",
    },
  });
}

/** A username that is safe inside a quoted Content-Disposition filename. */
function safeName(username: string): string {
  const clean = username.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return clean || "account";
}

/** Accent header row, frozen so it stays visible while scrolling. */
function styleAsHeader(ws: ExcelJS.Worksheet, rowNumber: number, span: number) {
  const row = ws.getRow(rowNumber);
  row.height = 22;
  for (let c = 1; c <= span; c += 1) {
    const cell = row.getCell(c);
    cell.font = { bold: true, size: 11, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ACCENT } };
    cell.alignment = { vertical: "middle" };
  }
  ws.views = [{ state: "frozen", ySplit: rowNumber }];
}

/** Apply a number format to a whole column, header excluded. */
function setColumnFormat(ws: ExcelJS.Worksheet, key: string, numFmt: string) {
  const column = ws.getColumn(key);
  column.numFmt = numFmt;
  column.eachCell((cell, rowNumber) => {
    if (rowNumber > 1) cell.numFmt = numFmt;
  });
}

/**
 * Subtle banding, hairlines, and a filter on the header, so a long ledger stays
 * readable and sortable by eye. Data sheets all carry their header on row 1.
 */
function stripe(ws: ExcelJS.Worksheet, span: number) {
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: span } };
  ws.eachRow((row, i) => {
    if (i === 1) return;
    for (let c = 1; c <= span; c += 1) {
      const cell = row.getCell(c);
      cell.border = { bottom: { style: "thin", color: { argb: HAIRLINE } } };
      if (i % 2 === 0) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ZEBRA } };
      }
    }
  });
}
