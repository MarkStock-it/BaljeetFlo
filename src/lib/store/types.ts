export type UserRow = {
  id: string;
  username: string;
  passwordHash: string;
  geminiApiKeyEnc: Buffer | null;
  monthlyIncome: number | null;
  hardSavingsGoal: number;
  reminderHour: number;
  onboardingDone: boolean;
};

export type CategoryRow = {
  id: string;
  userId: string;
  name: string;
  monthlyCap: number;
  flexible: boolean;
  sort: number;
};

export type RecurringRow = {
  id: string;
  userId: string;
  name: string;
  categoryId: string | null;
  amount: number;
  cadence: "daily" | "weekly" | "monthly";
  /** weekly only: 0 = Sunday … 6 = Saturday */
  weekdays: number[];
  /** monthly only: 1 to 31 */
  dayOfMonth: number | null;
  startDate: Date;
  endDate: Date | null;
  active: boolean;
  /** Last day already posted. The whole catch-up is idempotent on this value. */
  lastPostedOn: Date | null;
  note: string | null;
  createdAt: Date;
};

export type TxRow = {
  id: string;
  userId: string;
  categoryId: string | null;
  amount: number; // positive spend, negative refund
  vendor: string | null;
  note: string | null;
  source: "chat" | "voice" | "receipt" | "guardian" | "scheduled";
  rawInput: string | null;
  /** Set when this row was posted by a schedule rather than typed by the user. */
  recurringId?: string | null;
  spentAt: Date;
  stsBefore: number;
  stsAfter: number;
  flagged: boolean;
  refundedFrom: string | null;
};

export type ChatRow = {
  id: string;
  userId: string;
  role: "user" | "assistant";
  kind:
    | "text"
    | "log_card"
    | "tradeoff_card"
    | "clarify_chip"
    | "week_report"
    | "receipt_draft"
    | "nudge";
  payload: unknown | null;
  createdAt: Date;
};

export type PlanRow = {
  id: string;
  userId: string;
  name: string;
  targetAmount: number;
  savedAmount: number; // manual head start; monthly accrual is derived
  monthlySetAside: number; // reserved out of the flexible pool
  targetDate: Date | null;
  status: "active" | "done" | "paused";
  note: string | null;
  createdAt: Date;
};

/** What the budget editor sends up in one atomic write. */
export type BudgetWrite = {
  monthlyIncome: number;
  hardSavingsGoal: number;
  fixed: { id?: string; name: string; amount: number }[];
  flexible: { id?: string; name: string; monthlyCap: number }[];
};

export type TxFilters = {
  categoryId?: string;
  from?: Date;
  to?: Date;
  min?: number;
  max?: number;
  refunded?: boolean;
  page: number; // 0-based
  pageSize: number;
};

export interface DataStore {
  // users
  getUserByUsername(username: string): Promise<UserRow | null>;
  getUserById(id: string): Promise<UserRow | null>;
  createUser(u: {
    id: string;
    username: string;
    passwordHash: string;
  }): Promise<UserRow>;
  updateUser(id: string, patch: Partial<Omit<UserRow, "id" | "passwordHash">>): Promise<void>;
  setPasswordHash(id: string, passwordHash: string): Promise<void>;

  // categories
  getCategories(userId: string): Promise<CategoryRow[]>;
  upsertCategory(
    userId: string,
    c: { id?: string; name: string; monthlyCap: number; flexible: boolean; sort?: number }
  ): Promise<CategoryRow>;
  updateCategoryCap(userId: string, categoryId: string, monthlyCap: number): Promise<void>;
  deleteCategory(id: string): Promise<void>;
  /** Replaces the whole budget in one transaction, never a half-saved month. */
  saveBudget(userId: string, b: BudgetWrite): Promise<void>;

  // recurring payments (money on a rhythm)
  listRecurring(userId: string): Promise<RecurringRow[]>;
  createRecurring(r: RecurringRow): Promise<RecurringRow>;
  updateRecurring(id: string, patch: Partial<Omit<RecurringRow, "id" | "userId">>): Promise<void>;
  deleteRecurring(id: string): Promise<void>;
  deleteTransaction(id: string): Promise<void>;

  // plans (future purchases the user is setting money aside for)
  listPlans(userId: string): Promise<PlanRow[]>;
  createPlan(p: PlanRow): Promise<PlanRow>;
  updatePlan(id: string, patch: Partial<Omit<PlanRow, "id" | "userId">>): Promise<void>;
  deletePlan(id: string): Promise<void>;

  // transactions
  addTransaction(tx: TxRow): Promise<void>;
  listTransactions(userId: string, filters: TxFilters): Promise<{ rows: TxRow[]; total: number }>;
  getTransaction(id: string): Promise<TxRow | null>;
  updateTransaction(
    id: string,
    patch: Partial<Pick<TxRow, "categoryId" | "flagged" | "vendor">>
  ): Promise<void>;

  // trade-offs
  /**
   * Removes the reallocation recorded for a transaction and hands it back.
   *
   * A corrected reading has to put the donor caps back the way it found them,
   * otherwise the new trade-off is computed on top of the old one and the same
   * peso is taken out of the same category twice.
   */
  undoTradeOffs(transactionId: string): Promise<{ fromCategoryId: string; amount: number }[]>;
  addTradeOff(t: {
    id: string;
    userId: string;
    transactionId: string;
    overshoot: number;
    status: "auto" | "accepted" | "adjusted";
    moves: { fromCategoryId: string; amount: number }[];
  }): Promise<void>;

  // chat
  addChatMessage(m: ChatRow): Promise<void>;
  listChatMessages(userId: string, limit?: number): Promise<ChatRow[]>;
  /** Used when a reply is superseded, so the transcript keeps one answer per line. */
  deleteChatMessage(id: string): Promise<void>;

  // day stats (streak/stack)
  upsertDayStat(s: {
    userId: string;
    day: string; // YYYY-MM-DD
    spent: number;
    stsTarget: number;
    withinBudget: boolean;
  }): Promise<void>;
  listDayStats(userId: string, days: number): Promise<
    { day: string; spent: number; stsTarget: number; withinBudget: boolean }[]
  >;

  // guardian
  createGuardianLink(g: {
    id: string;
    userId: string;
    tokenHash: string;
    secretCode: string;
  }): Promise<void>;
  getGuardianByToken(tokenHash: string): Promise<{ userId: string; id: string; secretCode: string; redeemed: boolean } | null>;
  markGuardianRedeemed(id: string): Promise<void>;
  touchGuardian(id: string): Promise<void>;
}
