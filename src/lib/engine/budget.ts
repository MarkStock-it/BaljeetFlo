export type Category = {
  id: string;
  name: string;
  monthlyCap: number;
  flexible: boolean;
  spent: number; // month-to-date in this category
};

export type BudgetState = {
  income: number;
  hardSavingsGoal: number;
  categories: Category[];
  spentToday: number;
  committedPending: number; // due but not yet in the ledger
  /**
   * Money the rest of this month still owes to recurring payments. It shrinks
   * liquidity rather than today's allowance: the daily pace is what the user
   * feels, and this only binds when the commitments are genuinely large.
   */
  committedUpcoming?: number;
  timezoneOffsetMin?: number;
};

export type TxDraft = {
  amount: number;
  vendor?: string;
  note?: string;
  categoryId?: string | null;
  confidence?: number;
  refund?: boolean;
};

export type TradeOffMove = { fromCategoryId: string; amount: number };

export type TradeOffPlan = {
  categoryId: string;
  overshoot: number;
  moves: TradeOffMove[];
  partial: boolean;
};

/** Remaining flexible budget in a category this month. */
export function remaining(c: Category): number {
  return Math.max(0, c.monthlyCap - c.spent);
}

/**
 * The Safe-to-Spend number: (income - fixed costs - hard savings) paced by
 * days remaining this month, minus what's already spent/committed today.
 */
export function calculateSafeToSpend(state: BudgetState, at: Date = new Date()): number {
  const now = new Date(at);
  const y = now.getFullYear();
  const m = now.getMonth();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const daysRemaining = daysInMonth - now.getDate() + 1;

  const fixedMonthly = state.categories
    .filter((c) => !c.flexible)
    .reduce((s, c) => s + c.monthlyCap, 0);
  const flexibleMonthly = state.categories
    .filter((c) => c.flexible)
    .reduce((s, c) => s + c.monthlyCap, 0);

  const monthlyPool = Math.max(0, state.income - fixedMonthly - state.hardSavingsGoal);
  const dailyPace = monthlyPool / daysInMonth;

  // Flex liquidity left this month relative to pace, minus today's spend.
  const flexibleSpent = state.categories
    .filter((c) => c.flexible)
    .reduce((s, c) => s + c.spent, 0);
  const liquidity = Math.max(
    0,
    flexibleMonthly - flexibleSpent - (state.committedUpcoming ?? 0)
  );
  const paced = Math.min(dailyPace * daysRemaining, liquidity);

  return Math.max(0, paced - state.spentToday - state.committedPending);
}

/**
 * Zero-sum reallocator: cover an overspend by draining other flexible
 * categories, largest remaining first. Never touches fixed costs or savings.
 */
export function computeTradeOff(
  categories: Category[],
  categoryId: string,
  amount: number
): TradeOffPlan {
  const target = categories.find((c) => c.id === categoryId);
  const rem = target ? remaining(target) : 0;
  const overshoot = Math.max(0, amount - rem);

  if (overshoot === 0) {
    return { categoryId, overshoot: 0, moves: [], partial: false };
  }

  const donors = categories
    .filter((c) => c.flexible && c.id !== categoryId && remaining(c) > 0)
    .sort((a, b) => remaining(b) - remaining(a) || a.name.localeCompare(b.name));

  const moves: TradeOffMove[] = [];
  let need = overshoot;
  for (const d of donors) {
    if (need <= 0.005) break;
    const give = Math.min(remaining(d), need);
    if (give > 0) {
      moves.push({ fromCategoryId: d.id, amount: Math.round(give * 100) / 100 });
      need -= give;
    }
  }
  return {
    categoryId,
    overshoot,
    moves,
    partial: need > 0.005,
  };
}

/** Pure: apply a trade-off plan to state, returning new category spent values. */
export function applyTradeOff(
  state: BudgetState,
  categoryId: string,
  spendAmount: number,
  plan: TradeOffPlan
): BudgetState {
  const categories = state.categories.map((c) => {
    if (c.id === categoryId) return { ...c, spent: c.spent + spendAmount };
    const move = plan.moves.find((m) => m.fromCategoryId === c.id);
    if (move) return { ...c, monthlyCap: Math.max(0, c.monthlyCap - move.amount) };
    return c;
  });
  return { ...state, categories };
}

/** Total flexible budget after plan (used to prove zero-sum to the user). */
export function flexibleTotal(state: BudgetState): number {
  return state.categories.filter((c) => c.flexible).reduce((s, c) => s + c.monthlyCap, 0);
}
