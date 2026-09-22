import { daysAgoKey } from "@/lib/day";
import type {
  BudgetWrite,
  CategoryRow,
  ChatRow,
  DataStore,
  PlanRow,
  RecurringRow,
  TxFilters,
  TxRow,
  UserRow,
} from "./types";

const uuid = () => globalThis.crypto.randomUUID();

export class MemoryStore implements DataStore {
  private users: UserRow[] = [];
  private categories: CategoryRow[] = [];
  private plans: PlanRow[] = [];
  private recurring: RecurringRow[] = [];
  private txs: TxRow[] = [];
  private chats: ChatRow[] = [];
  private dayStats = new Map<string, { day: string; spent: number; stsTarget: number; withinBudget: boolean }>();
  private guardians: { id: string; userId: string; tokenHash: string; secretCode: string; redeemed: boolean; lastViewed: Date | null }[] = [];
  private tradeOffs: unknown[] = [];

  /**
   * Fills the store synchronously at boot. An async seed could lose the race
   * against the first request, which is how a seeded login can 401 on the very
   * first page load.
   */
  seed(rows: {
    users?: UserRow[];
    categories?: CategoryRow[];
    plans?: PlanRow[];
    recurring?: RecurringRow[];
    txs?: TxRow[];
    dayStats?: { userId: string; day: string; spent: number; stsTarget: number; withinBudget: boolean }[];
    guardians?: { id: string; userId: string; tokenHash: string; secretCode: string }[];
  }): void {
    if (rows.users) this.users.push(...rows.users);
    if (rows.categories) this.categories.push(...rows.categories);
    if (rows.plans) this.plans.push(...rows.plans);
    if (rows.recurring) this.recurring.push(...rows.recurring);
    if (rows.txs) this.txs.push(...rows.txs);
    for (const d of rows.dayStats ?? []) this.dayStats.set(`${d.userId}:${d.day}`, d);
    for (const g of rows.guardians ?? []) {
      this.guardians.push({ ...g, redeemed: false, lastViewed: null });
    }
  }

  async getUserByUsername(username: string) {
    return this.users.find((u) => u.username === username) ?? null;
  }
  async getUserById(id: string) {
    return this.users.find((u) => u.id === id) ?? null;
  }
  async createUser(u: { id: string; username: string; passwordHash: string }) {
    const row: UserRow = {
      ...u,
      geminiApiKeyEnc: null,
      monthlyIncome: null,
      hardSavingsGoal: 0,
      reminderHour: 19,
      onboardingDone: false,
    };
    this.users.push(row);
    return row;
  }
  async updateUser(id: string, patch: Partial<Omit<UserRow, "id" | "passwordHash">>) {
    const u = this.users.find((x) => x.id === id);
    if (u) Object.assign(u, patch);
  }
  async setPasswordHash(id: string, passwordHash: string) {
    const u = this.users.find((x) => x.id === id);
    if (u) u.passwordHash = passwordHash;
  }

  async getCategories(userId: string) {
    return this.categories.filter((c) => c.userId === userId).sort((a, b) => a.sort - b.sort);
  }
  async upsertCategory(
    userId: string,
    c: { id?: string; name: string; monthlyCap: number; flexible: boolean; sort?: number }
  ) {
    const existing = c.id ? this.categories.find((x) => x.id === c.id && x.userId === userId) : undefined;
    if (existing) {
      Object.assign(existing, c);
      return existing;
    }
    const row: CategoryRow = {
      id: uuid(),
      userId,
      name: c.name,
      monthlyCap: c.monthlyCap,
      flexible: c.flexible,
      sort: c.sort ?? this.categories.filter((x) => x.userId === userId).length,
    };
    this.categories.push(row);
    return row;
  }
  async updateCategoryCap(userId: string, categoryId: string, monthlyCap: number) {
    const c = this.categories.find((x) => x.id === categoryId && x.userId === userId);
    if (c) c.monthlyCap = monthlyCap;
  }
  async deleteCategory(id: string) {
    this.categories = this.categories.filter((c) => c.id !== id);
  }

  /**
   * Memory mode has no real transaction, so this mirrors the SQL store's
   * semantics: build the new set first, then swap it in one assignment.
   */
  async saveBudget(userId: string, b: BudgetWrite) {
    const others = this.categories.filter((c) => c.userId !== userId);
    let sort = 0;
    const next: CategoryRow[] = [
      ...b.fixed.map((f) => ({
        id: f.id ?? uuid(),
        userId,
        name: f.name,
        monthlyCap: f.amount,
        flexible: false,
        sort: sort++,
      })),
      ...b.flexible.map((f) => ({
        id: f.id ?? uuid(),
        userId,
        name: f.name,
        monthlyCap: f.monthlyCap,
        flexible: true,
        sort: sort++,
      })),
    ];
    this.categories = [...others, ...next];
    const u = this.users.find((x) => x.id === userId);
    if (u) {
      u.monthlyIncome = b.monthlyIncome;
      u.hardSavingsGoal = b.hardSavingsGoal;
    }
  }

  async listRecurring(userId: string) {
    return this.recurring
      .filter((r) => r.userId === userId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }
  async createRecurring(r: RecurringRow) {
    this.recurring.push(r);
    return r;
  }
  async updateRecurring(id: string, patch: Partial<Omit<RecurringRow, "id" | "userId">>) {
    const r = this.recurring.find((x) => x.id === id);
    if (r) Object.assign(r, patch);
  }
  async deleteRecurring(id: string) {
    this.recurring = this.recurring.filter((r) => r.id !== id);
  }
  async deleteTransaction(id: string) {
    this.txs = this.txs.filter((t) => t.id !== id);
  }

  async listPlans(userId: string) {
    return this.plans
      .filter((p) => p.userId === userId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }
  async createPlan(p: PlanRow) {
    this.plans.push(p);
    return p;
  }
  async updatePlan(id: string, patch: Partial<Omit<PlanRow, "id" | "userId">>) {
    const p = this.plans.find((x) => x.id === id);
    if (p) Object.assign(p, patch);
  }
  async deletePlan(id: string) {
    this.plans = this.plans.filter((p) => p.id !== id);
  }

  async addTransaction(tx: TxRow) {
    this.txs.push(tx);
  }

  async listTransactions(userId: string, f: TxFilters) {
    let rows = this.txs
      .filter((t) => t.userId === userId)
      .sort((a, b) => b.spentAt.getTime() - a.spentAt.getTime());
    if (f.categoryId) rows = rows.filter((t) => t.categoryId === f.categoryId);
    if (f.from) rows = rows.filter((t) => t.spentAt >= f.from!);
    if (f.to) rows = rows.filter((t) => t.spentAt <= f.to!);
    if (f.min !== undefined) rows = rows.filter((t) => Math.abs(t.amount) >= f.min!);
    if (f.max !== undefined) rows = rows.filter((t) => Math.abs(t.amount) <= f.max!);
    if (f.refunded !== undefined)
      rows = rows.filter((t) => (f.refunded ? t.amount < 0 || t.refundedFrom : t.amount > 0 && !t.refundedFrom));
    const total = rows.length;
    const page = rows.slice(f.page * f.pageSize, (f.page + 1) * f.pageSize);
    return { rows: page, total };
  }
  async getTransaction(id: string) {
    return this.txs.find((t) => t.id === id) ?? null;
  }
  async updateTransaction(id: string, patch: Partial<Pick<TxRow, "categoryId" | "flagged">>) {
    const t = this.txs.find((x) => x.id === id);
    if (t) Object.assign(t, patch);
  }

  async addTradeOff(t: {
    id: string;
    userId: string;
    transactionId: string;
    overshoot: number;
    status: "auto" | "accepted" | "adjusted";
    moves: { fromCategoryId: string; amount: number }[];
  }) {
    this.tradeOffs.push({ ...t, createdAt: new Date() });
  }

  async addChatMessage(m: ChatRow) {
    this.chats.push(m);
  }
  async listChatMessages(userId: string, limit = 200) {
    return this.chats
      .filter((c) => c.userId === userId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .slice(-limit);
  }

  async upsertDayStat(s: {
    userId: string;
    day: string;
    spent: number;
    stsTarget: number;
    withinBudget: boolean;
  }) {
    this.dayStats.set(`${s.userId}:${s.day}`, s);
  }
  async listDayStats(userId: string, days: number) {
    const out: { day: string; spent: number; stsTarget: number; withinBudget: boolean }[] = [];
    for (let i = 0; i < days; i++) {
      const row = this.dayStats.get(`${userId}:${daysAgoKey(i)}`);
      if (row) out.push(row);
    }
    return out;
  }

  async createGuardianLink(g: { id: string; userId: string; tokenHash: string; secretCode: string }) {
    this.guardians.push({ ...g, redeemed: false, lastViewed: null });
  }
  async getGuardianByToken(tokenHash: string) {
    const g = this.guardians.find((x) => x.tokenHash === tokenHash);
    return g ? { userId: g.userId, id: g.id, secretCode: g.secretCode, redeemed: g.redeemed } : null;
  }
  async markGuardianRedeemed(id: string) {
    const g = this.guardians.find((x) => x.id === id);
    if (g) g.redeemed = true;
  }
  async touchGuardian(id: string) {
    const g = this.guardians.find((x) => x.id === id);
    if (g) g.lastViewed = new Date();
  }
}
