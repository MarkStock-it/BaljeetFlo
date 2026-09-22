"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckIcon } from "@/components/icons";

type Step = 0 | 1 | 2 | 3 | 4;

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(0);
  const [income, setIncome] = useState("");
  const [savings, setSavings] = useState("");
  const [fixed, setFixed] = useState([
    { name: "Rent", amount: "" },
    { name: "Bills", amount: "" },
  ]);
  const [cats, setCats] = useState([
    { name: "Food", monthlyCap: "" },
    { name: "Transport", monthlyCap: "" },
    { name: "Fun", monthlyCap: "" },
  ]);
  const [apiKey, setApiKey] = useState("");
  const [keyState, setKeyState] = useState<"idle" | "valid" | "invalid">("idle");
  const [keyError, setKeyError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function validateAndSaveKey() {
    setBusy(true);
    setKeyError(null);
    try {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ geminiApiKey: apiKey.trim() }),
      });
      if (res.ok) setKeyState("valid");
      else {
        setKeyState("invalid");
        const data = await res.json();
        setKeyError(data.error ?? "That key didn't validate.");
      }
    } catch {
      setKeyState("invalid");
      setKeyError("Couldn't reach Google. Check your connection.");
    }
    setBusy(false);
  }

  async function finish() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        monthlyIncome: Number(income) || 0,
        hardSavingsGoal: Number(savings) || 0,
        fixedCosts: fixed.filter((f) => f.name && f.amount).map((f) => ({ name: f.name, amount: Number(f.amount) })),
        categories: cats.filter((c) => c.name && c.monthlyCap).map((c) => ({ name: c.name, monthlyCap: Number(c.monthlyCap) })),
      }),
    });
    setBusy(false);
    if (!res.ok) {
      setError("Saving didn't work. Try once more.");
      return;
    }
    router.push("/app");
  }

  return (
    <main className="flex min-h-[100dvh] flex-col px-6 py-14">
      <p className="micro">
        Step {step + 1} of 5
      </p>

      {step === 0 && (
        <>
          <h1 className="mt-2 text-[28px] font-bold leading-tight tracking-[-0.02em]">
            What comes in each month?
          </h1>
          <p className="sub mt-2 mb-6 max-w-[30ch]">Everything starts from this pool.</p>
          <input
            inputMode="decimal"
            placeholder="₱ 0.00"
            value={income}
            onChange={(e) => setIncome(e.target.value)}
            className="hero-num w-full bg-transparent outline-none"
            aria-label="Monthly income"
          />
        </>
      )}

      {step === 1 && (
        <>
          <h1 className="mt-2 text-[28px] font-bold leading-tight tracking-[-0.02em]">
            The costs that never move
          </h1>
          <p className="sub mt-2 mb-6 max-w-[32ch]">
            Rent, utilities, subscriptions. These leave before anything else.
          </p>
          <div className="space-y-3">
            {fixed.map((f, i) => (
              <div key={i} className="card-solid flex gap-3 p-4">
                <input
                  className="w-1/2 bg-transparent text-[16px] font-semibold outline-none"
                  value={f.name}
                  placeholder="Name"
                  aria-label="Cost name"
                  onChange={(e) => setFixed(fixed.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                />
                <input
                  inputMode="decimal"
                  className="num w-1/2 bg-transparent text-right text-[16px] outline-none"
                  value={f.amount}
                  placeholder="0"
                  aria-label="Cost amount"
                  onChange={(e) => setFixed(fixed.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))}
                />
              </div>
            ))}
            <button className="chip" onClick={() => setFixed([...fixed, { name: "", amount: "" }])}>
              Add another
            </button>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <h1 className="mt-2 text-[28px] font-bold leading-tight tracking-[-0.02em]">
            How much are you keeping?
          </h1>
          <p className="sub mt-2 mb-6 max-w-[34ch]">
            This is the floor. It leaves first and never bends, not even when everything else flexes.
          </p>
          <input
            inputMode="decimal"
            placeholder="₱ 0.00"
            value={savings}
            onChange={(e) => setSavings(e.target.value)}
            className="hero-num w-full bg-transparent outline-none"
            aria-label="Monthly savings goal"
          />
        </>
      )}

      {step === 3 && (
        <>
          <h1 className="mt-2 text-[28px] font-bold leading-tight tracking-[-0.02em]">
            Where the rest goes
          </h1>
          <p className="sub mt-2 mb-6 max-w-[34ch]">
            These categories trade against each other. Overspend one and another covers it. The
            total never grows.
          </p>
          <div className="space-y-3">
            {cats.map((c, i) => (
              <div key={i} className="card-solid flex gap-3 p-4">
                <input
                  className="w-1/2 bg-transparent text-[16px] font-semibold outline-none"
                  value={c.name}
                  placeholder="Category"
                  aria-label="Category name"
                  onChange={(e) => setCats(cats.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                />
                <input
                  inputMode="decimal"
                  className="num w-1/2 bg-transparent text-right text-[16px] outline-none"
                  value={c.monthlyCap}
                  placeholder="Monthly cap"
                  aria-label="Category cap"
                  onChange={(e) => setCats(cats.map((x, j) => (j === i ? { ...x, monthlyCap: e.target.value } : x)))}
                />
              </div>
            ))}
            <button className="chip" onClick={() => setCats([...cats, { name: "", monthlyCap: "" }])}>
              Add another
            </button>
          </div>
        </>
      )}

      {step === 4 && (
        <>
          <h1 className="mt-2 text-[28px] font-bold leading-tight tracking-[-0.02em]">
            Bring your own AI
          </h1>
          <p className="sub mt-2 mb-6 max-w-[34ch]">
            Paste a Gemini API key. I check it before saving, and it&apos;s encrypted from that moment on.
          </p>
          <input
            className="field"
            placeholder="AIza…"
            value={apiKey}
            onChange={(e) => {
              setApiKey(e.target.value);
              setKeyState("idle");
              setKeyError(null);
            }}
            autoCapitalize="none"
            autoCorrect="off"
            aria-label="Gemini API key"
          />
          <div className="mt-3 flex items-center gap-3">
            <button className="btn-ghost text-sm" disabled={!apiKey.trim() || busy} onClick={validateAndSaveKey}>
              Check it
            </button>
            {keyState === "valid" && (
              <span className="good-text inline-flex items-center gap-1.5 text-sm font-medium">
                <CheckIcon size={14} />
                Works
              </span>
            )}
            {keyState === "invalid" && <span className="warn-text text-sm">{keyError}</span>}
          </div>
        </>
      )}

      <div className="mt-auto flex gap-3 pt-10">
        {step > 0 && (
          <button className="btn-ghost flex-1" onClick={() => setStep((step - 1) as Step)}>
            Back
          </button>
        )}
        {step < 4 ? (
          <button
            className="btn-primary flex-1"
            onClick={() => setStep((step + 1) as Step)}
            disabled={step === 0 && !income}
          >
            Continue
          </button>
        ) : (
          <button className="btn-primary flex-1" onClick={finish} disabled={keyState !== "valid" || busy}>
            Start
          </button>
        )}
      </div>
      {error && <p className="warn-text mt-3 text-sm">{error}</p>}
    </main>
  );
}
