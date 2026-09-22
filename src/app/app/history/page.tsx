"use client";

import { useCallback, useEffect, useState } from "react";
import { FilterIcon, RepeatIcon, XIcon } from "@/components/icons";
import { dayKey } from "@/lib/day";
import { useBudgetSnapshot } from "@/lib/budget-snapshot";
import { readTabCache, writeTabCache } from "@/lib/tab-cache";

type Tx = {
  id: string;
  categoryId: string | null;
  amount: number;
  vendor: string | null;
  note: string | null;
  source?: string;
  /** Set when a schedule posted this row. */
  recurringId?: string | null;
  spentAt: string;
  stsBefore: number;
  stsAfter: number;
  flagged: boolean;
  refundedFrom: string | null;
};

type Cat = { id: string; name: string };

const peso = (n: number) =>
  `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function HistoryPage() {
  const [rows, setRows] = useState<Tx[]>(() => readTabCache<Tx[]>("history.rows", []));
  const [total, setTotal] = useState(() => readTabCache<number>("history.total", 0));
  const [loaded, setLoaded] = useState(() => rows.length > 0);
  const [page, setPage] = useState(0);
  // Category list comes from the shared snapshot, so it is already there on
  // arrival instead of appearing after a fetch.
  const cats: Cat[] = useBudgetSnapshot()?.categories ?? [];
  const [showFilters, setShowFilters] = useState(false);
  const [fCat, setFCat] = useState("");
  const [fMin, setFMin] = useState("");
  const [fMax, setFMax] = useState("");
  const [selected, setSelected] = useState<Tx | null>(null);
  const [refundedIds, setRefundedIds] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(
    async (p: number) => {
      const q = new URLSearchParams({ page: String(p), pageSize: "30" });
      if (fCat) q.set("categoryId", fCat);
      if (fMin) q.set("min", fMin);
      if (fMax) q.set("max", fMax);
      const res = await fetch(`/api/transactions?${q}`);
      if (!res.ok) {
        setLoaded(true);
        return;
      }
      const data = await res.json();
      setRows((prev) => {
        const next = p === 0 ? data.rows : [...prev, ...data.rows];
        writeTabCache("history.rows", next);
        return next;
      });
      setTotal(data.total);
      writeTabCache("history.total", data.total);
      setPage(p);
      setLoaded(true);
    },
    [fCat, fMin, fMax]
  );

  useEffect(() => {
    load(0);
  }, [load]);

  async function markRefunded(tx: Tx) {
    const res = await fetch("/api/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "refund", txId: tx.id }),
    });
    setSelected(null);
    if (res.ok) {
      setRefundedIds((s) => new Set(s).add(tx.id));
      setNotice(`${peso(Math.abs(tx.amount))} back. Safe-to-Spend updated.`);
      load(0);
    } else {
      const data = await res.json();
      setNotice(data.error ?? "The refund didn't save.");
    }
    setTimeout(() => setNotice(null), 4000);
  }

  /**
   * "I didn't have class today." Removes the posted charge for that day and
   * leaves the schedule itself alone, so tomorrow it posts again as usual.
   */
  async function removeScheduled(tx: Tx) {
    if (!tx.recurringId) return;
    const res = await fetch("/api/recurring", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "skip",
        id: tx.recurringId,
        day: dayKey(new Date(tx.spentAt)),
      }),
    });
    setSelected(null);
    if (res.ok) {
      setNotice(`Removed. ${peso(Math.abs(tx.amount))} back, and the schedule still runs.`);
      load(0);
    } else {
      const data = await res.json().catch(() => ({}));
      setNotice(data.error ?? "That didn't come out.");
    }
    setTimeout(() => setNotice(null), 4000);
  }

  const byDay = rows.reduce<Record<string, Tx[]>>((acc, t) => {
    const day = new Date(t.spentAt).toLocaleDateString("en-PH", {
      weekday: "long",
      month: "short",
      day: "numeric",
    });
    (acc[day] ??= []).push(t);
    return acc;
  }, {});

  const activeFilters = [
    fCat && cats.find((c) => c.id === fCat)?.name,
    fMin && `From ${peso(Number(fMin))}`,
    fMax && `Up to ${peso(Number(fMax))}`,
  ].filter(Boolean) as string[];

  return (
    <main className="px-4 pt-12">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-[26px] font-bold tracking-[-0.02em]">History</h1>
        <button
          className={`icon-btn ${showFilters || activeFilters.length ? "" : ""}`}
          style={activeFilters.length ? { color: "var(--accent)", borderColor: "var(--accent)" } : undefined}
          aria-label="Filters"
          aria-expanded={showFilters}
          onClick={() => setShowFilters(!showFilters)}
        >
          <FilterIcon />
        </button>
      </div>

      {showFilters && (
        <div className="card mb-4 space-y-3 p-4">
          <div className="flex flex-wrap gap-2">
            <button className={`chip ${!fCat ? "font-semibold" : ""}`} onClick={() => setFCat("")}>
              Everything
            </button>
            {cats.map((c) => (
              <button
                key={c.id}
                className={`chip ${fCat === c.id ? "font-semibold" : ""}`}
                style={fCat === c.id ? { borderColor: "var(--accent)", color: "var(--accent)" } : undefined}
                onClick={() => setFCat(fCat === c.id ? "" : c.id)}
              >
                {c.name}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              inputMode="decimal"
              placeholder="From ₱"
              value={fMin}
              onChange={(e) => setFMin(e.target.value)}
              className="field num"
            />
            <input
              inputMode="decimal"
              placeholder="Up to ₱"
              value={fMax}
              onChange={(e) => setFMax(e.target.value)}
              className="field num"
            />
          </div>
        </div>
      )}

      {activeFilters.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {activeFilters.map((f) => (
            <span key={f} className="chip">
              {f}
            </span>
          ))}
          <button
            className="chip inline-flex items-center gap-1"
            onClick={() => {
              setFCat("");
              setFMin("");
              setFMax("");
            }}
          >
            <XIcon size={13} />
            Clear
          </button>
        </div>
      )}

      {notice && (
        <p className="card-solid mb-4 p-3 text-sm" role="status">
          {notice}
        </p>
      )}

      {Object.entries(byDay).map(([day, txs]) => (
        <section key={day} className="mb-6">
          <h2 className="micro mb-2 font-medium">{day}</h2>
          <div className="card-solid rows">
            {txs.map((t) => {
              const refunded = t.refundedFrom || refundedIds.has(t.id);
              return (
                <button
                  key={t.id}
                  className="flex w-full items-center justify-between px-4 py-3.5 text-left"
                  onClick={() => setSelected(t)}
                >
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 truncate text-[15px] font-medium">
                      <span className="truncate">{t.vendor ?? t.note ?? "Expense"}</span>
                      {t.recurringId && (
                        <span
                          className="inline-flex shrink-0 items-center gap-1 text-[11px]"
                          style={{ color: "var(--ink-2)" }}
                          title="Posted by a scheduled payment"
                        >
                          <RepeatIcon size={11} />
                          scheduled
                        </span>
                      )}
                      {t.amount < 0 && <span className="good-text shrink-0 text-[13px]">refund</span>}
                      {refunded && t.amount > 0 && <span className="micro shrink-0">refunded</span>}
                    </p>
                    <p className="micro num mt-0.5">
                      {peso(t.stsBefore)} → {peso(t.stsAfter)}
                    </p>
                  </div>
                  <p className={`num ml-3 shrink-0 font-semibold ${t.amount < 0 ? "good-text" : ""}`}>
                    {t.amount < 0 ? "+" : "−"}
                    {peso(Math.abs(t.amount))}
                  </p>
                </button>
              );
            })}
          </div>
        </section>
      ))}

      {rows.length < total && (
        <button className="btn-ghost mb-8 w-full" onClick={() => load(page + 1)}>
          Show 30 more
        </button>
      )}

      {!loaded && <p className="micro mt-10 text-center">Loading your history…</p>}

      {loaded && rows.length === 0 && (
        <div className="card mx-auto mt-10 max-w-[80%] p-6 text-center">
          <p className="text-[15px]">Nothing logged yet. Tell Flow what you spent and it lands here.</p>
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 z-50 flex items-end backdrop-blur-[2px]" style={{ background: "var(--scrim)" }} onClick={() => setSelected(null)}>
          <div
            className="card-solid mx-auto mb-4 w-full max-w-md rounded-b-[28px] p-6"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Transaction detail"
          >
            <h3 className="text-lg font-bold">{selected.vendor ?? selected.note ?? "Expense"}</h3>
            <p className="num mt-1 text-[34px] font-bold tracking-tight">{peso(Math.abs(selected.amount))}</p>
            <p className="sub num mt-1 text-sm">
              Safe to spend {peso(selected.stsBefore)} → {peso(selected.stsAfter)}
            </p>
            {selected.recurringId && (
              <button className="btn-primary mt-5 w-full" onClick={() => removeScheduled(selected)}>
                <span className="inline-flex items-center justify-center gap-2">
                  <RepeatIcon size={15} />
                  Remove this charge
                </span>
              </button>
            )}
            {!selected.refundedFrom && !refundedIds.has(selected.id) && selected.amount > 0 && (
              <button
                className={selected.recurringId ? "btn-ghost mt-2.5 w-full" : "btn-primary mt-5 w-full"}
                onClick={() => markRefunded(selected)}
              >
                Log a refund for this
              </button>
            )}
            <button className="btn-ghost mt-2.5 w-full" onClick={() => setSelected(null)}>
              Close
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
