"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AllocationMeter } from "@/components/AllocationMeter";
import { refreshBudget, updateBudgetSnapshot, useBudgetSnapshot } from "@/lib/budget-snapshot";
import {
  BookIcon,
  CalendarIcon,
  CheckIcon,
  ChevronRightIcon,
  IncomeIcon,
  LockIcon,
  RepeatIcon,
  ShieldIcon,
  TargetIcon,
  UserIcon,
  WalletIcon,
} from "@/components/icons";

type KeyInfo = { configured: boolean; verified?: boolean; broken?: boolean };
type GuardianInfo = { url: string; code: string };

const peso = (n: number) =>
  `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pesoShort = (n: number) => `₱${Math.round(n).toLocaleString("en-PH")}`;

const HOURS = [18, 19, 20, 21];

export default function SetupPage() {
  const router = useRouter();
  const snap = useBudgetSnapshot();
  const [keyInfo, setKeyInfo] = useState<KeyInfo | null>(null);
  const [guardian, setGuardian] = useState<GuardianInfo | null>(null);
  const [newKey, setNewKey] = useState("");
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    void refreshBudget();
    fetch("/api/key-status")
      .then((r) => (r.ok ? r.json() : null))
      .then(setKeyInfo)
      .catch(() => {});
  }, []);

  useEffect(load, [load]);

  async function createGuardianLink() {
    setBusy(true);
    const res = await fetch("/api/guardian", { method: "POST" });
    if (res.ok) setGuardian(await res.json());
    setBusy(false);
  }

  async function saveKey() {
    setKeyBusy(true);
    setKeyError(null);
    const res = await fetch("/api/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ geminiApiKey: newKey.trim() }),
    });
    setKeyBusy(false);
    if (res.ok) {
      setKeyInfo({ configured: true, verified: true });
      setNewKey("");
    } else {
      const data = await res.json();
      setKeyError(data.error ?? "That key didn't validate. Check it and try again.");
    }
  }

  async function setHour(hour: number) {
    updateBudgetSnapshot({ reminderHour: hour });
    await fetch("/api/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reminderHour: hour }),
    });
  }

  async function signOut() {
    await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "logout" }),
    });
    router.push("/");
  }

  const alloc = snap?.allocation;
  const fixed = snap?.categories.filter((c) => !c.flexible) ?? [];
  const flex = snap?.categories.filter((c) => c.flexible) ?? [];
  const fixedTotal = fixed.reduce((s, c) => s + c.cap, 0);

  return (
    <main className="px-5 pt-12">
      <h1 className="text-[26px] font-bold tracking-[-0.02em]">Setup</h1>
      <p className="sub mt-1.5 max-w-[34ch]">
        Every rule BudgetFlow obeys. Change any of them and the Safe-to-Spend number updates with it.
      </p>

      {/* ── The budget ─────────────────────────────────────────────────── */}
      <section className="card-solid mt-6 overflow-hidden">
        <div className="flex items-center gap-3 p-6 pb-4">
          <span
            className="inline-flex h-9 w-9 items-center justify-center rounded-full"
            style={{ background: "var(--paper-2)", color: "var(--ink-2)" }}
          >
            <WalletIcon size={17} />
          </span>
          <h2 className="text-[17px] font-bold">Your budget</h2>
          {alloc && (
            <span
              className="tag ml-auto"
              data-tone={alloc.over > 0 ? "warn" : alloc.unallocated > 0 ? "quiet" : "good"}
            >
              {alloc.over > 0
                ? `${pesoShort(alloc.over)} over`
                : alloc.unallocated > 0
                  ? `${pesoShort(alloc.unallocated)} unassigned`
                  : "Balanced"}
            </span>
          )}
        </div>

        {snap && (
          <>
            <div className="px-6">
              <AllocationMeter flex={flex} planReserved={snap.planReserved} unallocated={alloc?.unallocated ?? 0} />
              <p className="micro mt-2.5">
                {flex.length} categories sharing {pesoShort(alloc?.flexiblePool ?? 0)}
                {snap.planReserved > 0 ? ` · ${pesoShort(snap.planReserved)} reserved for plans` : ""}
              </p>
            </div>

            <div className="rows mt-5 px-6">
              <Row icon={<IncomeIcon size={16} />} label="Comes in" value={peso(snap.income)} />
              <Row icon={<LockIcon size={16} />} label="Fixed costs" value={peso(fixedTotal)} />
              <Row icon={<ShieldIcon size={16} />} label="Savings floor" value={peso(snap.hardSavingsGoal)} />
              {snap.planReserved > 0 && (
                <Row icon={<TargetIcon size={16} />} label="Set aside for plans" value={peso(snap.planReserved)} />
              )}
              {snap.recurringCommitted > 0 && (
                <Row
                  icon={<RepeatIcon size={16} />}
                  label="Scheduled, still to come"
                  value={peso(snap.recurringCommitted)}
                />
              )}
              <Row
                icon={<WalletIcon size={16} />}
                label="Left to spend"
                value={peso(alloc?.flexiblePool ?? 0)}
                strong
              />
            </div>
          </>
        )}

        <Link href="/app/setup/budget" className="btn-ghost mx-6 my-5 flex items-center justify-center gap-2">
          Adjust your budget
        </Link>
      </section>

      {/* ── Tutorial ───────────────────────────────────────────────────── */}
      <Link href="/app/guide" className="card-solid mt-4 flex items-center gap-4 p-6">
        <span
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
          style={{ background: "var(--paper-2)", color: "var(--ink-2)" }}
        >
          <BookIcon size={17} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[17px] font-bold">Tutorial</span>
          <span className="sub mt-0.5 block">How your number is built</span>
        </span>
        <ChevronRightIcon className="chev" size={16} />
      </Link>

      {/* ── Plans ──────────────────────────────────────────────────────── */}
      <Link href="/app/plans" className="card-solid mt-4 flex items-center gap-4 p-6">
        <span
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
          style={{ background: "var(--paper-2)", color: "var(--ink-2)" }}
        >
          <TargetIcon size={17} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[17px] font-bold">Plans</span>
          <span className="sub mt-0.5 block truncate">
            {[
              snap?.plans.length
                ? `${snap.plans.length} in progress · ${pesoShort(snap.planReserved)} a month set aside`
                : null,
              snap?.recurring.length
                ? `${snap.recurring.length} on a schedule`
                : null,
            ]
              .filter(Boolean)
              .join(" · ") || "Nothing promised yet"}
          </span>
        </span>
        <ChevronRightIcon className="chev" size={16} />
      </Link>

      {/* ── Weekly check-in ────────────────────────────────────────────── */}
      <section className="card-solid mt-4 p-6">
        <div className="flex items-center gap-3">
          <span
            className="inline-flex h-9 w-9 items-center justify-center rounded-full"
            style={{ background: "var(--paper-2)", color: "var(--ink-2)" }}
          >
            <CalendarIcon size={17} />
          </span>
          <h2 className="text-[17px] font-bold">Evening check-in</h2>
        </div>
        <p className="sub mt-3 text-[14px] leading-relaxed">
          Flow asks about the day&apos;s spending once, at the hour you pick. It can&apos;t be switched
          off, because the habit is the whole system. But it can be moved to when you actually sit down.
        </p>
        <div className="mt-4 flex gap-2">
          {HOURS.map((h) => (
            <button
              key={h}
              className="chip flex-1 text-center"
              style={
                snap?.reminderHour === h
                  ? { borderColor: "var(--accent)", color: "var(--accent)", fontWeight: 600 }
                  : undefined
              }
              aria-pressed={snap?.reminderHour === h}
              onClick={() => setHour(h)}
            >
              {h}:00
            </button>
          ))}
        </div>
      </section>

      {/* ── AI key ─────────────────────────────────────────────────────── */}
      <section className="card-solid mt-4 p-6">
        <div className="flex items-center gap-3">
          <span
            className="inline-flex h-9 w-9 items-center justify-center rounded-full"
            style={{ background: "var(--paper-2)", color: "var(--ink-2)" }}
          >
            <LockIcon size={17} />
          </span>
          <h2 className="text-[17px] font-bold">Your AI key</h2>
          {keyInfo?.configured && keyInfo.verified && (
            <span className="good-text ml-auto inline-flex items-center gap-1 text-[13px] font-medium">
              <CheckIcon size={13} />
              Active
            </span>
          )}
          {keyInfo && !keyInfo.configured && (
            <span className="warn-text ml-auto text-[13px] font-medium">Not set up</span>
          )}
          {keyInfo?.broken && (
            <span className="warn-text ml-auto text-[13px] font-medium">Needs attention</span>
          )}
        </div>
        <p className="sub mt-3 text-[14px] leading-relaxed">
          BudgetFlow runs on your own Gemini key. New keys from AI Studio start with AQ. and are long,
          so paste the whole thing. It&apos;s checked against Google before it&apos;s saved and encrypted
          from that moment on. Nothing about your spending is used to train anything.
        </p>
        <div className="mt-4 flex gap-2">
          <input
            type="password"
            className="field"
            placeholder="AQ.… or AIza…"
            value={newKey}
            onChange={(e) => {
              setNewKey(e.target.value);
              setKeyError(null);
            }}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          <button
            className="btn-primary shrink-0 px-5"
            onClick={saveKey}
            disabled={!newKey.trim() || keyBusy}
          >
            {keyBusy ? "Checking…" : "Save"}
          </button>
        </div>
        {keyError && <p className="warn-text mt-2.5 text-[14px]">{keyError}</p>}
      </section>

      {/* ── Guardian ───────────────────────────────────────────────────── */}
      <section className="card-solid mt-4 p-6">
        <div className="flex items-center gap-3">
          <span
            className="inline-flex h-9 w-9 items-center justify-center rounded-full"
            style={{ background: "var(--paper-2)", color: "var(--ink-2)" }}
          >
            <UserIcon size={17} />
          </span>
          <h2 className="text-[17px] font-bold">Someone you trust</h2>
        </div>
        <p className="sub mt-3 text-[14px] leading-relaxed">
          Share a read-only view of your savings goal and today&apos;s Safe-to-Spend. They never see
          individual purchases, and they can&apos;t change a single rule. The code works once; the link
          keeps working after that.
        </p>
        {guardian ? (
          <div className="mt-4 space-y-2.5">
            <div className="rounded-[10px] border border-[var(--hairline)] p-3.5">
              <p className="micro">Link to send</p>
              <p className="mt-1 break-all text-[14px]">
                {typeof window !== "undefined"
                  ? `${window.location.origin}${guardian.url}`
                  : guardian.url}
              </p>
            </div>
            <div className="rounded-[10px] border border-[var(--hairline)] p-3.5">
              <p className="micro">One-time code</p>
              <p className="num mt-1 text-xl font-bold tracking-[0.2em]">{guardian.code}</p>
            </div>
            <p className="micro">Write the code down before you leave this screen. It won&apos;t show again.</p>
          </div>
        ) : (
          <button
            className="btn-ghost mt-4 inline-flex items-center gap-2"
            onClick={createGuardianLink}
            disabled={busy}
          >
            <ShieldIcon size={16} />
            {busy ? "Generating…" : "Create their access"}
          </button>
        )}
      </section>

      <p className="micro mt-6 px-1 leading-relaxed">
        Passwords are hashed. Your key is encrypted at rest. Spending lives in the database so clearing
        your browser can never wipe your progress.
      </p>

      <button className="btn-ghost mb-12 mt-5 w-full" onClick={signOut}>
        Sign out
      </button>
    </main>
  );
}

function Row({
  icon,
  label,
  value,
  strong,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 py-3 text-[15px]">
      <span style={{ color: "var(--ink-3)" }}>{icon}</span>
      <span className={strong ? "font-semibold" : ""}>{label}</span>
      <span className={`num ml-auto ${strong ? "font-semibold" : "text-[var(--ink-2)]"}`}>{value}</span>
    </div>
  );
}

