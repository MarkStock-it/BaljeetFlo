import { MemoryStore } from "./memory";
import { hashPassword } from "@/lib/bcrypt";
import { sha256 } from "@/lib/auth/crypto";
import { daysAgoKey } from "@/lib/day";
import type { CategoryRow, PlanRow, TxRow, UserRow } from "./types";

const uuid = () => globalThis.crypto.randomUUID();
const day = 86_400_000;

/**
 * Hardcoded demo account so you can log in instantly while the real database is
 * unreachable. Login: jumong09 / jumong09.
 *
 * Seeded synchronously on purpose: the store must already contain the account
 * before the first request is handled, otherwise the login succeeds and every
 * other route answers 401. Memory mode resets on server restart.
 *
 * The numbers are internally consistent: they obey the same zero-sum rule the
 * app enforces: 25,000 income − 14,500 fixed − 3,000 savings − 1,500 plan
 * reserve = 6,000 split across four flexible categories.
 */
export function createSeededMemoryStore(): MemoryStore {
  const store = new MemoryStore();
  const userId = uuid();
  const now = Date.now();

  const user: UserRow = {
    id: userId,
    username: "jumong09",
    passwordHash: hashPassword("jumong09"),
    geminiApiKeyEnc: null,
    monthlyIncome: 25000,
    hardSavingsGoal: 3000,
    reminderHour: 19,
    onboardingDone: true,
  };

  const category = (name: string, monthlyCap: number, flexible: boolean, sort: number): CategoryRow => ({
    id: uuid(),
    userId,
    name,
    monthlyCap,
    flexible,
    sort,
  });

  const rent = category("Rent", 12000, false, 0);
  const bills = category("Bills", 2500, false, 1);
  const food = category("Food", 3000, true, 10);
  const transport = category("Transport", 1200, true, 11);
  const fun = category("Fun", 1200, true, 12);
  const shopping = category("Shopping", 600, true, 13);

  const startedSixMonthsAgo = new Date(now);
  startedSixMonthsAgo.setMonth(startedSixMonthsAgo.getMonth() - 6);
  const laptopDeadline = new Date(now);
  laptopDeadline.setMonth(laptopDeadline.getMonth() + 18);

  const plan: PlanRow = {
    id: uuid(),
    userId,
    name: "Laptop",
    targetAmount: 45000,
    savedAmount: 12000,
    monthlySetAside: 1500,
    targetDate: laptopDeadline,
    status: "active",
    note: "Replace the one that keeps dying during finals",
    createdAt: startedSixMonthsAgo,
  };

  const seeded: [CategoryRow, number, string, string, TxRow["source"]][] = [
    [food, 180, "Jollibee", "Chicken joy meal", "chat"],
    [transport, 60, "Grab", "Ride to school", "chat"],
    [fun, 250, "Steam", "Weekend game sale", "chat"],
    [food, 95, "7-Eleven", "Matcha latte and croissant", "receipt"],
  ];

  const txs: TxRow[] = seeded.map(([category, amount, vendor, note, source], i) => ({
    id: uuid(),
    userId,
    categoryId: category.id,
    amount,
    vendor,
    note,
    source,
    rawInput: null,
    spentAt: new Date(now - i * day - 3 * 3600_000),
    stsBefore: 550 - i * 120,
    stsAfter: 550 - i * 120 - amount,
    flagged: false,
    refundedFrom: null,
  }));

  store.seed({
    users: [user],
    categories: [rent, bills, food, transport, fun, shopping],
    plans: [plan],
    txs,
    dayStats: [
      { userId, day: daysAgoKey(0), spent: 180, stsTarget: 650, withinBudget: true },
      { userId, day: daysAgoKey(1), spent: 340, stsTarget: 650, withinBudget: true },
    ],
    guardians: [
      { id: uuid(), userId, tokenHash: sha256("demo-guardian-token"), secretCode: "246810" },
    ],
  });

  console.log("[BudgetFlow] Seeded demo account → username: jumong09  password: jumong09");
  return store;
}
