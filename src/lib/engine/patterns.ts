export type TxLite = {
  amount: number;
  categoryId?: string | null;
  spentAt: string; // ISO
};

export type Insight = { kind: string; text: string };

/** Deterministic heuristics that feed Gemini for wording. */
export function detectPatterns(txs: TxLite[], categoryNames: Record<string, string>): Insight[] {
  const out: Insight[] = [];
  if (txs.length === 0) return out;

  // Day-of-week spikes
  const byDow: Record<number, number> = {};
  for (const t of txs) {
    const dow = new Date(t.spentAt).getDay();
    byDow[dow] = (byDow[dow] ?? 0) + t.amount;
  }
  const dowNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const entries = Object.entries(byDow).sort((a, b) => b[1] - a[1]);
  if (entries.length > 1 && entries[0][1] > entries[1][1] * 1.4) {
    out.push({
      kind: "dow_spike",
      text: `${dowNames[+entries[0][0]]} is your heaviest spending day (₱${Math.round(entries[0][1])} this period).`,
    });
  }

  // Category concentration
  const byCat: Record<string, number> = {};
  for (const t of txs) {
    if (!t.categoryId) continue;
    byCat[t.categoryId] = (byCat[t.categoryId] ?? 0) + t.amount;
  }
  const catEntries = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  if (catEntries.length > 0) {
    const total = catEntries.reduce((s, [, v]) => s + v, 0);
    const top = catEntries[0];
    if (total > 0 && top[1] / total > 0.45) {
      const name = categoryNames[top[0]] ?? "your top category";
      out.push({
        kind: "category_concentration",
        text: `${Math.round((top[1] / total) * 100)}% of your spending went to ${name}.`,
      });
    }
  }

  // Frequent small purchases
  const smalls = txs.filter((t) => t.amount < 300).length; // heuristic threshold
  if (smalls >= 5) {
    out.push({
      kind: "small_leak",
      text: `${smalls} small purchases logged. Long-tail spending adds up.`,
    });
  }

  return out;
}
