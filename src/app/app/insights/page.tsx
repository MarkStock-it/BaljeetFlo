"use client";

import { useEffect, useState } from "react";
import { SparkIcon } from "@/components/icons";
import { CashPile } from "@/components/CashPile";

type StackData = {
  stack: { pct: number; blocks: number; streakDays: number };
  heuristics: { kind: string; text: string }[];
};

type Report = { headline: string; observations: string[]; recommendations: string[] };

export default function InsightsPage() {
  const [data, setData] = useState<StackData | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/insights")
      .then((r) => (r.ok ? r.json() : null))
      .then(setData)
      .catch(() => {});
  }, []);

  async function analyzeNow() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/insights", { method: "POST" });
      if (res.ok) setReport((await res.json()).report);
      else setError("The analysis didn't run. Try again in a moment.");
    } catch {
      setError("You seem to be offline.");
    }
    setBusy(false);
  }

  const pct = data?.stack.pct ?? 1;
  const days = data?.stack.streakDays ?? 0;

  return (
    <main className="px-5 pt-12">
      <h1 className="mb-7 text-[26px] font-bold tracking-[-0.02em]">Insights</h1>

      <section className="card rise flex flex-col items-center p-6 text-center">
        <p className="text-[13px] font-medium text-[var(--ink-2)]">Your stack</p>
        <div className="mt-6">
          <CashPile pct={pct} />
        </div>
        <p className="sub num mt-5">
          {Math.round(pct * 100)}% of your flexible budget is intact
          {days > 0 ? ` · ${days} day${days === 1 ? "" : "s"} on pace` : ""}
        </p>
      </section>

      {data?.heuristics?.length ? (
        <section className="mt-6 space-y-2.5">
          <h2 className="text-[13px] font-medium text-[var(--ink-2)]">Worth knowing</h2>
          {data.heuristics.map((h) => (
            <div key={h.kind} className="card-solid p-4 text-[15px] leading-relaxed">
              {h.text}
            </div>
          ))}
        </section>
      ) : null}

      {report && (
        <section className="card-solid mt-6 p-6">
          <h2 className="text-lg font-bold">{report.headline}</h2>
          <ul className="mt-3 space-y-2 text-[15px] leading-relaxed">
            {report.observations.map((o, i) => (
              <li key={i} className="flex gap-2.5">
                <span aria-hidden className="mt-[9px] h-1 w-1 shrink-0 rounded-full" style={{ background: "var(--ink-3)" }} />
                {o}
              </li>
            ))}
          </ul>
          {report.recommendations.length > 0 && (
            <>
              <h3 className="mt-5 text-[13px] font-medium text-[var(--ink-2)]">What I&apos;d do</h3>
              <ul className="mt-2 space-y-2 text-[15px] leading-relaxed">
                {report.recommendations.map((r, i) => (
                  <li key={i} className="flex gap-2.5">
                    <span aria-hidden className="mt-[9px] h-1 w-1 shrink-0 rounded-full" style={{ background: "var(--warn)" }} />
                    {r}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      {error && <p className="warn-text mt-4 text-sm">{error}</p>}

      <button className="btn-primary mt-8 mb-10 w-full" onClick={analyzeNow} disabled={busy}>
        <span className="inline-flex items-center gap-2">
          <SparkIcon size={16} />
          {busy ? "Reading your week…" : "Review my week"}
        </span>
      </button>
    </main>
  );
}
