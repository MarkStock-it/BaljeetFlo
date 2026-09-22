import mariadb from "mariadb";
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

/**
 * MariaDB-backed DataStore. Activated only when MARIADB_* env vars are present.
 * All queries are parameterized. Schema lives in db/schema.sql.
 */
export class MariaDbStore implements DataStore {
  private pool: ReturnType<typeof mariadb.createPool>;

  constructor() {
    this.pool = mariadb.createPool({
      host: process.env.MARIADB_HOST!,
      port: Number(process.env.MARIADB_PORT ?? 3306),
      user: process.env.MARIADB_USER!,
      password: process.env.MARIADB_PASSWORD!,
      database: process.env.MARIADB_DATABASE!,
      connectionLimit: 10,
    });
  }

  async getUserByUsername(username: string) {
    const rows = await this.pool.query("SELECT * FROM users WHERE username = ?", [username]);
    return rows[0] ? this.mapUser(rows[0]) : null;
  }
  async getUserById(id: string) {
    const rows = await this.pool.query("SELECT * FROM users WHERE id = ?", [id]);
    return rows[0] ? this.mapUser(rows[0]) : null;
  }
  async createUser(u: { id: string; username: string; passwordHash: string }) {
    await this.pool.query(
      "INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)",
      [u.id, u.username, u.passwordHash]
    );
    return (await this.getUserById(u.id))!;
  }
  async updateUser(id: string, patch: Partial<Omit<UserRow, "id" | "passwordHash">>) {
    const map: Record<string, string> = {
      geminiApiKeyEnc: "gemini_api_key_enc",
      monthlyIncome: "monthly_income",
      hardSavingsGoal: "hard_savings_goal",
      reminderHour: "reminder_hour",
      onboardingDone: "onboarding_done",
    };
    const sets = Object.keys(patch).map((k) => `${map[k]} = ?`);
    const vals = Object.values(patch);
    await this.pool.query(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`, [...vals, id]);
  }
  async setPasswordHash(id: string, passwordHash: string) {
    await this.pool.query("UPDATE users SET password_hash = ? WHERE id = ?", [passwordHash, id]);
  }

  async getCategories(userId: string) {
    const rows = await this.pool.query(
      "SELECT * FROM categories WHERE user_id = ? ORDER BY sort",
      [userId]
    );
    return rows.map(
      (r: Record<string, unknown>): CategoryRow => ({
        id: String(r.id),
        userId: String(r.user_id),
        name: String(r.name),
        monthlyCap: Number(r.monthly_cap),
        flexible: Boolean(r.flexible),
        sort: Number(r.sort),
      })
    );
  }
  async upsertCategory(
    userId: string,
    c: { id?: string; name: string; monthlyCap: number; flexible: boolean; sort?: number }
  ) {
    const id = c.id ?? uuid();
    await this.pool.query(
      `INSERT INTO categories (id, user_id, name, monthly_cap, flexible, sort)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name), monthly_cap = VALUES(monthly_cap),
       flexible = VALUES(flexible), sort = VALUES(sort)`,
      [id, userId, c.name, c.monthlyCap, c.flexible, c.sort ?? 0]
    );
    return { id, userId, name: c.name, monthlyCap: c.monthlyCap, flexible: c.flexible, sort: c.sort ?? 0 };
  }
  async updateCategoryCap(userId: string, categoryId: string, monthlyCap: number) {
    await this.pool.query("UPDATE categories SET monthly_cap = ? WHERE id = ? AND user_id = ?", [
      monthlyCap, categoryId, userId,
    ]);
  }
  async deleteCategory(id: string) {
    await this.pool.query("DELETE FROM categories WHERE id = ?", [id]);
  }

  /**
   * One transaction for the whole budget: income, savings and every category
   * either land together or not at all. A half-written month would silently
   * corrupt the Safe-to-Spend number, so this is never a sequence of loose
   * writes.
   */
  async saveBudget(userId: string, b: BudgetWrite) {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query("UPDATE users SET monthly_income = ?, hard_savings_goal = ? WHERE id = ?", [
        b.monthlyIncome,
        b.hardSavingsGoal,
        userId,
      ]);
      const keep = [...b.fixed, ...b.flexible].map((r) => r.id).filter(Boolean) as string[];
      if (keep.length) {
        await conn.query(
          `DELETE FROM categories WHERE user_id = ? AND id NOT IN (${keep.map(() => "?").join(",")})`,
          [userId, ...keep]
        );
      } else {
        await conn.query("DELETE FROM categories WHERE user_id = ?", [userId]);
      }

      let sort = 0;
      for (const f of b.fixed) {
        await conn.query(
          `INSERT INTO categories (id, user_id, name, monthly_cap, flexible, sort)
           VALUES (?, ?, ?, ?, FALSE, ?)
           ON DUPLICATE KEY UPDATE name = VALUES(name), monthly_cap = VALUES(monthly_cap),
           flexible = FALSE, sort = VALUES(sort)`,
          [f.id ?? uuid(), userId, f.name, f.amount, sort++]
        );
      }
      for (const f of b.flexible) {
        await conn.query(
          `INSERT INTO categories (id, user_id, name, monthly_cap, flexible, sort)
           VALUES (?, ?, ?, ?, TRUE, ?)
           ON DUPLICATE KEY UPDATE name = VALUES(name), monthly_cap = VALUES(monthly_cap),
           flexible = TRUE, sort = VALUES(sort)`,
          [f.id ?? uuid(), userId, f.name, f.monthlyCap, sort++]
        );
      }
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }

  async listRecurring(userId: string) {
    const rows = await this.pool.query(
      "SELECT * FROM recurring_payments WHERE user_id = ? ORDER BY created_at ASC",
      [userId]
    );
    return rows.map((r: Record<string, unknown>) => this.mapRecurring(r));
  }
  async createRecurring(r: RecurringRow) {
    await this.pool.query(
      `INSERT INTO recurring_payments
       (id, user_id, name, category_id, amount, cadence, weekdays, day_of_month,
        start_date, end_date, active, last_posted_on, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        r.id, r.userId, r.name, r.categoryId, r.amount, r.cadence,
        r.weekdays.join(","), r.dayOfMonth, r.startDate, r.endDate, r.active,
        r.lastPostedOn, r.note,
      ]
    );
    return r;
  }
  async updateRecurring(id: string, patch: Partial<Omit<RecurringRow, "id" | "userId">>) {
    const map: Record<string, string> = {
      name: "name",
      categoryId: "category_id",
      amount: "amount",
      cadence: "cadence",
      weekdays: "weekdays",
      dayOfMonth: "day_of_month",
      startDate: "start_date",
      endDate: "end_date",
      active: "active",
      lastPostedOn: "last_posted_on",
      note: "note",
    };
    const keys = Object.keys(patch).filter((k) => k in map);
    if (!keys.length) return;
    const sets = keys.map((k) => `${map[k]} = ?`);
    const vals = keys.map((k) => {
      const v = (patch as Record<string, unknown>)[k];
      return Array.isArray(v) ? v.join(",") : v;
    });
    await this.pool.query(`UPDATE recurring_payments SET ${sets.join(", ")} WHERE id = ?`, [
      ...vals,
      id,
    ]);
  }
  async deleteRecurring(id: string) {
    await this.pool.query("DELETE FROM recurring_payments WHERE id = ?", [id]);
  }
  async deleteTransaction(id: string) {
    await this.pool.query("DELETE FROM transactions WHERE id = ?", [id]);
  }

  async listPlans(userId: string) {
    const rows = await this.pool.query(
      "SELECT * FROM plans WHERE user_id = ? ORDER BY created_at ASC",
      [userId]
    );
    return rows.map((r: Record<string, unknown>) => this.mapPlan(r));
  }
  async createPlan(p: PlanRow) {
    await this.pool.query(
      `INSERT INTO plans (id, user_id, name, target_amount, saved_amount, monthly_set_aside, target_date, status, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        p.id, p.userId, p.name, p.targetAmount, p.savedAmount, p.monthlySetAside,
        p.targetDate, p.status, p.note,
      ]
    );
    return p;
  }
  async updatePlan(id: string, patch: Partial<Omit<PlanRow, "id" | "userId">>) {
    const map: Record<string, string> = {
      name: "name",
      targetAmount: "target_amount",
      savedAmount: "saved_amount",
      monthlySetAside: "monthly_set_aside",
      targetDate: "target_date",
      status: "status",
      note: "note",
    };
    const keys = Object.keys(patch).filter((k) => k in map);
    if (!keys.length) return;
    const sets = keys.map((k) => `${map[k]} = ?`);
    const vals = keys.map((k) => (patch as Record<string, unknown>)[k]);
    await this.pool.query(`UPDATE plans SET ${sets.join(", ")} WHERE id = ?`, [...vals, id]);
  }
  async deletePlan(id: string) {
    await this.pool.query("DELETE FROM plans WHERE id = ?", [id]);
  }

  async addTransaction(tx: TxRow) {
    await this.pool.query(
      `INSERT INTO transactions
       (id, user_id, category_id, amount, vendor, note, source, raw_input,
        recurring_id, spent_at, sts_before, sts_after, flagged, refunded_from)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tx.id, tx.userId, tx.categoryId, tx.amount, tx.vendor, tx.note, tx.source,
        tx.rawInput, tx.recurringId ?? null, tx.spentAt, tx.stsBefore, tx.stsAfter,
        tx.flagged, tx.refundedFrom,
      ]
    );
  }
  async listTransactions(userId: string, f: TxFilters) {
    const where: string[] = ["user_id = ?"];
    const vals: unknown[] = [userId];
    if (f.categoryId) { where.push("category_id = ?"); vals.push(f.categoryId); }
    if (f.from) { where.push("spent_at >= ?"); vals.push(f.from); }
    if (f.to) { where.push("spent_at <= ?"); vals.push(f.to); }
    if (f.min !== undefined) { where.push("ABS(amount) >= ?"); vals.push(f.min); }
    if (f.max !== undefined) { where.push("ABS(amount) <= ?"); vals.push(f.max); }
    if (f.refunded !== undefined) {
      where.push(f.refunded ? "(amount < 0 OR refunded_from IS NOT NULL)" : "(amount > 0 AND refunded_from IS NULL)");
    }
    const totalRows = await this.pool.query(
      `SELECT COUNT(*) AS n FROM transactions WHERE ${where.join(" AND ")}`, vals
    );
    const rows = await this.pool.query(
      `SELECT * FROM transactions WHERE ${where.join(" AND ")}
       ORDER BY spent_at DESC LIMIT ? OFFSET ?`,
      [...vals, f.pageSize, f.page * f.pageSize]
    );
    return { rows: rows.map((r: Record<string, unknown>) => this.mapTx(r)), total: Number(totalRows[0].n) };
  }
  async getTransaction(id: string) {
    const rows = await this.pool.query("SELECT * FROM transactions WHERE id = ?", [id]);
    return rows[0] ? this.mapTx(rows[0]) : null;
  }
  async updateTransaction(id: string, patch: Partial<Pick<TxRow, "categoryId" | "flagged">>) {
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (patch.categoryId !== undefined) { sets.push("category_id = ?"); vals.push(patch.categoryId); }
    if (patch.flagged !== undefined) { sets.push("flagged = ?"); vals.push(patch.flagged); }
    if (sets.length) {
      await this.pool.query(`UPDATE transactions SET ${sets.join(", ")} WHERE id = ?`, [...vals, id]);
    }
  }

  async addTradeOff(t: {
    id: string; userId: string; transactionId: string; overshoot: number;
    status: "auto" | "accepted" | "adjusted";
    moves: { fromCategoryId: string; amount: number }[];
  }) {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(
        "INSERT INTO trade_offs (id, user_id, transaction_id, overshoot, status) VALUES (?, ?, ?, ?, ?)",
        [t.id, t.userId, t.transactionId, t.overshoot, t.status]
      );
      for (const m of t.moves) {
        await conn.query(
          "INSERT INTO trade_off_moves (id, trade_off_id, from_category, amount) VALUES (?, ?, ?, ?)",
          [uuid(), t.id, m.fromCategoryId, m.amount]
        );
      }
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }

  async addChatMessage(m: ChatRow) {
    await this.pool.query(
      "INSERT INTO chat_messages (id, user_id, role, kind, payload) VALUES (?, ?, ?, ?, ?)",
      [m.id, m.userId, m.role, m.kind, m.payload ? JSON.stringify(m.payload) : null]
    );
  }
  async listChatMessages(userId: string, limit = 200) {
    const rows = await this.pool.query(
      `SELECT * FROM (SELECT * FROM chat_messages WHERE user_id = ?
       ORDER BY created_at DESC LIMIT ?) sub ORDER BY created_at ASC`,
      [userId, limit]
    );
    return rows.map((r: Record<string, unknown>) => ({
      id: String(r.id),
      userId: String(r.user_id),
      role: r.role as "user" | "assistant",
      kind: r.kind as ChatRow["kind"],
      payload: r.payload ? JSON.parse(String(r.payload)) : null,
      createdAt: new Date(String(r.created_at)),
    }));
  }

  async upsertDayStat(s: {
    userId: string; day: string; spent: number; stsTarget: number; withinBudget: boolean;
  }) {
    await this.pool.query(
      `INSERT INTO day_stats (user_id, day, spent, sts_target, within_budget)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE spent = VALUES(spent), sts_target = VALUES(sts_target),
       within_budget = VALUES(within_budget)`,
      [s.userId, s.day, s.spent, s.stsTarget, s.withinBudget]
    );
  }
  async listDayStats(userId: string, days: number) {
    const rows = await this.pool.query(
      `SELECT day, spent, sts_target, within_budget FROM day_stats
       WHERE user_id = ? ORDER BY day DESC LIMIT ?`,
      [userId, days]
    );
    return rows.map((r: Record<string, unknown>) => ({
      day: String(r.day),
      spent: Number(r.spent),
      stsTarget: Number(r.sts_target),
      withinBudget: Boolean(r.within_budget),
    }));
  }

  async createGuardianLink(g: { id: string; userId: string; tokenHash: string; secretCode: string }) {
    await this.pool.query(
      "INSERT INTO guardian_links (id, user_id, token_hash, secret_code) VALUES (?, ?, ?, ?)",
      [g.id, g.userId, g.tokenHash, g.secretCode]
    );
  }
  async getGuardianByToken(tokenHash: string) {
    const rows = await this.pool.query("SELECT * FROM guardian_links WHERE token_hash = ?", [tokenHash]);
    return rows[0]
      ? {
          userId: String(rows[0].user_id),
          id: String(rows[0].id),
          secretCode: String(rows[0].secret_code),
          redeemed: Boolean(rows[0].redeemed),
        }
      : null;
  }
  async markGuardianRedeemed(id: string) {
    await this.pool.query("UPDATE guardian_links SET redeemed = TRUE WHERE id = ?", [id]);
  }
  async touchGuardian(id: string) {
    await this.pool.query("UPDATE guardian_links SET last_viewed = CURRENT_TIMESTAMP WHERE id = ?", [id]);
  }

  private mapRecurring(r: Record<string, unknown>): RecurringRow {
    return {
      id: String(r.id),
      userId: String(r.user_id),
      name: String(r.name),
      categoryId: r.category_id ? String(r.category_id) : null,
      amount: Number(r.amount),
      cadence: r.cadence as RecurringRow["cadence"],
      weekdays: r.weekdays
        ? String(r.weekdays)
            .split(",")
            .filter((s) => s !== "")
            .map(Number)
        : [],
      dayOfMonth: r.day_of_month === null ? null : Number(r.day_of_month),
      startDate: new Date(String(r.start_date)),
      endDate: r.end_date ? new Date(String(r.end_date)) : null,
      active: Boolean(r.active),
      lastPostedOn: r.last_posted_on ? new Date(String(r.last_posted_on)) : null,
      note: r.note ? String(r.note) : null,
      createdAt: new Date(String(r.created_at)),
    };
  }
  private mapPlan(r: Record<string, unknown>): PlanRow {
    return {
      id: String(r.id),
      userId: String(r.user_id),
      name: String(r.name),
      targetAmount: Number(r.target_amount),
      savedAmount: Number(r.saved_amount),
      monthlySetAside: Number(r.monthly_set_aside),
      targetDate: r.target_date ? new Date(String(r.target_date)) : null,
      status: r.status as PlanRow["status"],
      note: r.note ? String(r.note) : null,
      createdAt: new Date(String(r.created_at)),
    };
  }
  private mapUser(r: Record<string, unknown>): UserRow {
    return {
      id: String(r.id),
      username: String(r.username),
      passwordHash: String(r.password_hash),
      geminiApiKeyEnc: (r.gemini_api_key_enc as Buffer) ?? null,
      monthlyIncome: r.monthly_income === null ? null : Number(r.monthly_income),
      hardSavingsGoal: Number(r.hard_savings_goal),
      reminderHour: Number(r.reminder_hour),
      onboardingDone: Boolean(r.onboarding_done),
    };
  }
  private mapTx(r: Record<string, unknown>): TxRow {
    return {
      id: String(r.id),
      userId: String(r.user_id),
      categoryId: r.category_id ? String(r.category_id) : null,
      amount: Number(r.amount),
      vendor: r.vendor ? String(r.vendor) : null,
      note: r.note ? String(r.note) : null,
      source: r.source as TxRow["source"],
      rawInput: r.raw_input ? String(r.raw_input) : null,
      recurringId: r.recurring_id ? String(r.recurring_id) : null,
      spentAt: new Date(String(r.spent_at)),
      stsBefore: Number(r.sts_before),
      stsAfter: Number(r.sts_after),
      flagged: Boolean(r.flagged),
      refundedFrom: r.refunded_from ? String(r.refunded_from) : null,
    };
  }
}
