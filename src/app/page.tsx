"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LockIcon } from "@/components/icons";

export default function AuthPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: mode, username, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "That didn't work. Try again.");
        setBusy(false);
        return;
      }
      router.push(data.onboardingDone === false ? "/onboarding" : "/app");
    } catch {
      setError("You seem to be offline. Check your connection.");
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-[100dvh] flex-col justify-center px-6">
      <div className="rise mb-10">
        <div
          className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-[14px]"
          style={{ background: "var(--ink)", color: "var(--paper)" }}
        >
          <LockIcon size={22} />
        </div>
        <h1 className="text-[32px] font-bold tracking-[-0.02em]">BudgetFlow</h1>
        <p className="sub mt-1.5 max-w-[28ch]">
          Spend freely inside guardrails you set. Savings stay fixed; everything else adapts.
        </p>
      </div>

      <form onSubmit={submit} className="card-solid space-y-4 p-6">
        <div>
          <label htmlFor="username" className="mb-1.5 block text-[13px] font-medium">Username</label>
          <input
            id="username"
            className="field"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoCapitalize="none"
            autoComplete="username"
            required
          />
        </div>
        <div>
          <label htmlFor="password" className="mb-1.5 block text-[13px] font-medium">Password</label>
          <input
            id="password"
            type="password"
            className="field"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            required
          />
        </div>
        {error && (
          <p className="warn-text text-sm" role="alert">
            {error}
          </p>
        )}
        <button className="btn-primary w-full" disabled={busy}>
          {mode === "login" ? "Sign in" : "Create account"}
        </button>
        <button
          type="button"
          className="sub w-full text-[14px] font-medium"
          onClick={() => {
            setMode(mode === "login" ? "register" : "login");
            setError(null);
          }}
        >
          {mode === "login" ? "New here? Create an account" : "Already have an account? Sign in"}
        </button>
      </form>

      <p className="micro mt-8 text-center">Your data is hashed and encrypted at rest.</p>
    </main>
  );
}
