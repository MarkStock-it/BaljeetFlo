"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  LockIcon,
  RepeatIcon,
  ShieldIcon,
  TargetIcon,
} from "@/components/icons";
import { TradeOffSandbox } from "@/components/TradeOffSandbox";
import { calculateSafeToSpend, type Category } from "@/lib/engine/budget";

type Snapshot = {
  income: number;
  hardSavingsGoal: number;
  spentToday: number;
  safeToSpend: number;
  hasGeminiKey: boolean;
  planReserved: number;
  monthTransactions: number;
  categories: { id: string; name: string; flexible: boolean; cap: number; spent: number }[];
  allocation: { flexiblePool: number; allocated: number; over: number; unallocated: number; ok: boolean };
  plans: { id: string; name: string; targetAmount: number; monthlySetAside: number }[];
  recurring: { id: string; name: string; amount: number }[];
};

const peso = (n: number) =>
  `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pesoShort = (n: number) => `₱${Math.round(n).toLocaleString("en-PH")}`;

const EXAMPLES = [
  "Spent ₱180 at Jollibee",
  "Grab to school, ₱60",
  "Matcha latte and a croissant, ₱95",
  "Got refunded ₱250 from Steam",
  "Can I afford ₱1,500 shoes?",
  "I'm saving up for a laptop, ₱45,000 by March",
  "I pay ₱100 for transport every Mon, Wed and Fri",
];

export default function GuidePage() {
  const [snap, setSnap] = useState<Snapshot | null>(null);

  useEffect(() => {
    fetch("/api/budget")
      .then((r) => (r.ok ? r.json() : null))
      .then(setSnap)
      .catch(() => {});
  }, []);

  const cats: Category[] = (snap?.categories ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    monthlyCap: c.cap,
    flexible: c.flexible,
    spent: c.spent,
  }));

  const fixedTotal = cats.filter((c) => !c.flexible).reduce((s, c) => s + c.monthlyCap, 0);
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysLeft = daysInMonth - now.getDate() + 1;

  // The same engine the whole app runs on, so the walkthrough can't drift
  // from what the hero number does.
  const live = snap
    ? calculateSafeToSpend({
        income: snap.income,
        hardSavingsGoal: snap.hardSavingsGoal,
        categories: cats,
        spentToday: snap.spentToday,
        committedPending: 0,
      })
    : 0;

  const flexTotal = cats.filter((c) => c.flexible).reduce((s, c) => s + c.monthlyCap, 0);
  const flexSpent = cats.filter((c) => c.flexible).reduce((s, c) => s + c.spent, 0);
  const pool = snap ? Math.max(0, snap.income - fixedTotal - snap.hardSavingsGoal) : 0;
  const pace = pool / daysInMonth;
  const pacedByDays = pace * daysLeft;
  const liquidity = Math.max(0, flexTotal - flexSpent);

  const checklist = snap
    ? [
        { label: "Monthly income set", done: snap.income > 0, href: "/app/setup/budget" },
        {
          label: "Categories balanced to your pool",
          done: snap.allocation.ok && snap.allocation.allocated > 0,
          href: "/app/setup/budget",
        },
        { label: "Your own Gemini key added", done: snap.hasGeminiKey, href: "/app/setup" },
        { label: "First expense logged", done: snap.monthTransactions > 0, href: "/app" },
        { label: "Something set aside for later", done: snap.planReserved > 0, href: "/app/plans" },
      ]
    : [];

  return (
    <main className="pb-16">
      <header
        className="sticky top-0 z-30 flex items-center gap-1 border-b px-3 py-3 backdrop-blur-xl"
        style={{ borderColor: "var(--hairline)", background: "var(--surface)" }}
      >
        <Link
          href="/app/setup"
          className="inline-flex h-9 w-9 items-center justify-center rounded-full"
          style={{ color: "var(--ink-2)" }}
          aria-label="Back to setup"
        >
          <ChevronLeftIcon size={20} />
        </Link>
        <h1 className="text-[17px] font-bold">How BudgetFlow works</h1>
      </header>

      <div className="px-5">
        <p className="sub mt-6 max-w-[38ch] text-[15px] leading-relaxed">
          Two minutes, no jargon. Every figure below is yours. Pull the sliders around and the app
          will tell you the truth rather than a friendly version of it.
        </p>

        {!snap && <p className="micro mt-8">Loading your numbers…</p>}

        {/* ── Where you stand ───────────────────────────────────────────── */}
        {snap && (
          <section className="card-solid mt-6 overflow-hidden">
            <h2 className="px-4 pb-1 pt-4 text-[15px] font-semibold">Where you stand</h2>
            <div className="rows">
              {checklist.map((item) => (
                <Link key={item.label} href={item.href} className="flex items-center gap-3 px-4 py-3">
                  <span
                    className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border"
                    style={{
                      borderColor: item.done ? "var(--good)" : "var(--hairline-strong)",
                      background: item.done ? "var(--good)" : "transparent",
                      color: "#fff",
                    }}
                  >
                    {item.done && <CheckIcon size={12} />}
                  </span>
                  <span className="text-[15px]" style={{ color: item.done ? undefined : "var(--ink-2)" }}>
                    {item.label}
                  </span>
                  <ChevronRightIcon className="chev ml-auto" size={15} />
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* ── 01 · One number ───────────────────────────────────────────── */}
        <Chapter n="01" title="One number, made from four">
          <p>
            Everything starts with what comes in. Fixed costs leave first: rent, bills, the things
            that don&apos;t care what month it is. Then your savings floor leaves, before a single peso
            is spendable. What remains is divided across the days that are left.
          </p>
          {snap && (
            <div className="figure mt-4">
              <p className="micro">Today&apos;s number, line by line</p>
              <div className="formula mt-2">
                <div>
                  {peso(snap.income)} <span className="op">in</span>
                </div>
                <div>
                  − {peso(fixedTotal)} <span className="op">fixed</span>
                </div>
                <div>
                  − {peso(snap.hardSavingsGoal)} <span className="op">savings floor</span>
                </div>
                <div className="rule">
                  = {peso(pool)} <span className="op">spendable this month</span>
                </div>
                <div>
                  ÷ {daysInMonth} <span className="op">days = {peso(pace)} a day</span>
                </div>
                <div>
                  × {daysLeft} <span className="op">days left = {peso(pacedByDays)}</span>
                </div>
                <div className="rule">
                  {peso(flexTotal)} <span className="op">sitting in categories</span>
                </div>
                <div>
                  − {peso(flexSpent)} <span className="op">spent this month</span>
                </div>
                <div>
                  = {peso(liquidity)} <span className="op">left to spend</span>
                </div>
                <div>
                  − {peso(snap.spentToday)} <span className="op">spent today</span>
                </div>
              </div>
              <div
                className="mt-4 flex items-baseline justify-between border-t pt-3"
                style={{ borderColor: "var(--hairline)" }}
              >
                <span className="micro">Whichever is tighter, minus today</span>
                <span className="num text-[19px] font-bold">{peso(live)}</span>
              </div>
              <p className="micro mt-2 leading-relaxed">
                Plans never appear in that sum directly. They show up as smaller category caps, which
                is why {peso(snap.planReserved)} of this month is already spoken for. This is not a
                summary of what you did; it&apos;s the same live calculation the app runs when you ask
                it anything.
              </p>
            </div>
          )}
        </Chapter>

        {/* ── 02 · Conversational logging ───────────────────────────────── */}
        <Chapter n="02" title="Say it, don’t file it">
          <p>
            There are no forms, no dropdowns, no receipt folders. You talk. BudgetFlow reads the
            amount, the place and the category, then writes it down. Voice works offline of any AI:
            your phone does the listening, so the only thing that ever reaches a model is text.
          </p>
          <div className="mt-4 space-y-2">
            {EXAMPLES.map((e) => (
              <p key={e} className="card-solid px-4 py-3 text-[15px]" style={{ borderRadius: 14 }}>
                {e}
              </p>
            ))}
          </div>
          <p className="micro mt-3 leading-relaxed">
            The last three aren&apos;t expenses. One is a question answered with the consequence
            before you commit, one becomes a plan, and one becomes a schedule that posts itself.
          </p>
        </Chapter>

        {/* ── 03 · Zero sum ─────────────────────────────────────────────── */}
        <Chapter n="03" title="Nothing comes from nowhere">
          <p>
            Overspending never raises a limit. It moves the money: the categories with room give it up
            so the one that ran over keeps the limit it was given. Your savings floor is never part of
            that conversation.
          </p>
          {snap && (
            <div className="figure mt-4">
              <TradeOffSandbox
                categories={cats}
                income={snap.income}
                hardSavingsGoal={snap.hardSavingsGoal}
                spentToday={snap.spentToday}
              />
            </div>
          )}
        </Chapter>

        {/* ── 04 · Plans ────────────────────────────────────────────────── */}
        <Chapter n="04" title="Plans take money off the table">
          <p>
            A plan is a fixed monthly slice reserved before categories get their share. It is the only
            reliable way to buy something expensive later: the money is spoken for the day it arrives,
            not the day you need it.
          </p>
          {snap && (
            <div className="figure mt-4">
              {snap.plans.length ? (
                <>
                  <p className="micro">Reserved right now</p>
                  {snap.plans.map((p) => (
                    <div key={p.id} className="mt-2 flex items-baseline justify-between">
                      <span className="text-[15px] font-medium">{p.name}</span>
                      <span className="num text-[15px]">{pesoShort(p.monthlySetAside)} a month</span>
                    </div>
                  ))}
                  <p className="micro mt-3 leading-relaxed">
                    That {pesoShort(snap.planReserved)} is already gone from the pool above, which is
                    why it survives a bad week.
                  </p>
                </>
              ) : (
                <>
                  <p className="text-[15px] leading-relaxed">
                    Nothing reserved yet. Say what you want in chat, like “I&apos;m saving up for a
                    laptop, ₱45,000 by March”, and Flow works out the monthly slice.
                  </p>
                  <Link href="/app/plans" className="btn-ghost mt-4 inline-flex items-center gap-2 py-3 text-sm">
                    <TargetIcon size={16} />
                    Open plans
                  </Link>
                </>
              )}
            </div>
          )}
        </Chapter>

        {/* ── 05 · Money on a rhythm ───────────────────────────────────── */}
        <Chapter n="05" title="Money on a rhythm">
          <p>
            Fares on class days, data every Monday, rent on the 1st. Set them once in chat (“I pay
            ₱100 for transport every Mon, Wed and Fri”) or in Plans, and they post themselves on the
            day, before you would have typed anything.
          </p>
          <div className="figure mt-4">
            {snap?.recurring?.length ? (
              <>
                <p className="micro">Posting on their own</p>
                {snap.recurring.map((r) => (
                  <div key={r.id} className="mt-2 flex items-baseline justify-between gap-3">
                    <span className="truncate text-[15px] font-medium">{r.name}</span>
                    <span className="num shrink-0 text-[15px]">{pesoShort(r.amount)}</span>
                  </div>
                ))}
              </>
            ) : (
              <>
                <p className="text-[15px] leading-relaxed">
                  Nothing scheduled yet. If you pay the same thing over and over, saying it once is
                  the last time you&apos;ll have to.
                </p>
                <Link
                  href="/app/plans"
                  className="btn-ghost mt-4 inline-flex items-center gap-2 py-3 text-sm"
                >
                  <RepeatIcon size={16} />
                  Open plans
                </Link>
              </>
            )}
          </div>
          <p className="micro mt-3 leading-relaxed">
            They come out of the same pool as everything else, so the hero number stays honest from
            the moment the day begins. Didn&apos;t actually go in? Pull that one charge from History
            and the rhythm keeps running.
          </p>
        </Chapter>

        {/* ── 06 · Your data ───────────────────────────────────────────── */}
        <Chapter n="06" title="Your data, and who can see it">
          <div className="mt-1 space-y-3">
            <Fact icon={<LockIcon size={16} />} title="Your own AI key">
              BudgetFlow runs on your Gemini key, encrypted at rest and checked against Google before
              it&apos;s ever saved. Spending categorisation happens with the key you own.
            </Fact>
            <Fact icon={<ShieldIcon size={16} />} title="Passwords are hashed">
              Nothing readable is stored. Your ledger lives in the database, not in your browser, so
              clearing a cache can&apos;t wipe your progress.
            </Fact>
            <Fact icon={<CheckIcon size={16} />} title="Someone you trust is read-only">
              They see your savings floor and today&apos;s number. Never a single purchase, and they
              can&apos;t change a rule.
            </Fact>
            <Fact icon={<ChevronRightIcon size={16} />} title="No bank logins">
              There is no Plaid, no account linking, no scraping. If it isn&apos;t said in chat, it
              isn&apos;t known.
            </Fact>
          </div>
        </Chapter>

        <Link href="/app/setup" className="btn-primary mt-8 w-full">
          Change any of these rules
        </Link>
        <p className="micro mt-3 text-center leading-relaxed">
          Setup holds every number this app obeys: income, fixed costs, savings floor and categories.
        </p>
      </div>
    </main>
  );
}

function Chapter({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <div className="flex items-baseline gap-3">
        <span className="num micro">{n}</span>
        <h2 className="text-[21px] font-bold tracking-[-0.01em]">{title}</h2>
      </div>
      <div className="mt-3 text-[15px] leading-relaxed">{children}</div>
    </section>
  );
}

function Fact({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card-solid flex gap-3.5 p-4">
      <span className="mt-0.5 shrink-0" style={{ color: "var(--ink-2)" }}>
        {icon}
      </span>
      <div>
        <p className="text-[15px] font-semibold">{title}</p>
        <p className="sub mt-1 text-[13.5px] leading-relaxed">{children}</p>
      </div>
    </div>
  );
}
