/** Money Stack + streak. Stack starts FULL and shrinks as the user spends. */

export type StackInfo = {
  pct: number; // 0..1 remaining fill
  blocks: number; // total blocks in visual
  streakDays: number;
};

export function stackValue(opts: {
  flexibleTotal: number;
  flexibleSpent: number;
  dayStats: { day: string; withinBudget: boolean }[];
}): StackInfo {
  const { flexibleTotal, flexibleSpent, dayStats } = opts;
  const pct = flexibleTotal <= 0 ? 0 : Math.max(0, Math.min(1, 1 - flexibleSpent / flexibleTotal));

  // Streak = consecutive most-recent days within budget (sorted desc by day).
  const sorted = [...dayStats].sort((a, b) => (a.day < b.day ? 1 : -1));
  let streak = 0;
  for (const d of sorted) {
    if (d.withinBudget) streak++;
    else break;
  }
  return { pct, blocks: 12, streakDays: streak };
}
