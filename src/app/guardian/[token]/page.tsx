"use client";

import { useEffect, useState } from "react";
import { ShieldIcon } from "@/components/icons";

type Params = { token: string };

type Snapshot = {
  username?: string;
  hardSavingsGoal?: number;
  safeToSpend?: string;
};

export default function GuardianPage({ params }: { params: Params }) {
  const token = params?.token;
  const [code, setCode] = useState("");
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // If the link was already redeemed once, show the snapshot directly.
  useEffect(() => {
    if (!token) return;
    fetch(`/api/guardian?token=${encodeURIComponent(token)}`)
      .then(async (r) => {
        if (r.ok) setSnap(await r.json());
      })
      .catch(() => {});
  }, [token]);

  async function redeem(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch(
      `/api/guardian?token=${encodeURIComponent(token ?? "")}&code=${encodeURIComponent(code)}`
    );
    const data = await res.json();
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "That code doesn't match.");
    setSnap(data);
  }

  if (!token) {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center px-6">
        <p className="sub">This link is incomplete.</p>
      </main>
    );
  }

  return (
    <main className="flex min-h-[100dvh] flex-col justify-center px-6">
      {!snap ? (
        <form onSubmit={redeem} className="card-solid rise space-y-4 p-6">
          <div className="inline-flex h-11 w-11 items-center justify-center rounded-full" style={{ background: "var(--paper-2)", color: "var(--ink-2)" }}>
            <ShieldIcon size={20} />
          </div>
          <h1 className="text-[22px] font-bold tracking-[-0.02em]">Guardian view</h1>
          <p className="sub text-sm">
            Enter the six-digit code they shared with you. You&apos;ll see their savings goal and today&apos;s
            spending pace, and nothing else.
          </p>
          <input
            inputMode="numeric"
            maxLength={6}
            className="field num text-center text-[22px] tracking-[0.35em]"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            aria-label="Six-digit code"
            required
          />
          {error && (
            <p className="warn-text text-sm" role="alert">
              {error}
            </p>
          )}
          <button className="btn-primary w-full" disabled={busy || code.length !== 6}>
            {busy ? "Checking…" : "View"}
          </button>
        </form>
      ) : (
        <div className="rise text-center">
          <p className="text-[13px] font-medium text-[var(--ink-2)]">{snap.username}&apos;s savings goal</p>
          <h1 className="hero-num mt-2">₱{(snap.hardSavingsGoal ?? 0).toLocaleString("en-PH")}</h1>
          <div className="card-solid mt-8 p-6">
            <p className="text-[13px] font-medium text-[var(--ink-2)]">Safe to spend today</p>
            <p className="num mt-1.5 text-[32px] font-bold tracking-tight">{snap.safeToSpend}</p>
          </div>
          <p className="micro mt-8">
            Read-only on purpose. Purchases stay private to them.
          </p>
        </div>
      )}
    </main>
  );
}
