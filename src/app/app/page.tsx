"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  MicIcon,
  ReceiptIcon,
  SendIcon,
  CheckIcon,
  SwapIcon,
  CameraIcon,
  ImageIcon,
  BookIcon,
  TargetIcon,
  RepeatIcon,
} from "@/components/icons";
import { safeUuid } from "@/lib/uuid";
import { CashPile } from "@/components/CashPile";

type Card = {
  type:
    | "log_card"
    | "tradeoff_card"
    | "clarify_chip"
    | "receipt_draft"
    | "plan_draft"
    | "recurring_draft";
  txId?: string;
  name?: string;
  targetAmount?: number;
  monthlySetAside?: number;
  deadline?: string | null;
  // recurring_draft
  cadence?: "daily" | "weekly" | "monthly";
  weekdays?: number[];
  dayOfMonth?: number | null;
  categoryId?: string | null;
  categoryName?: string | null;
  when?: string;
  monthlyEstimate?: number;
  needsDays?: boolean;
  before?: number;
  after?: number;
  amount?: number;
  refund?: boolean;
  overshoot?: number;
  partial?: boolean;
  moves?: { fromId: string; from?: string; amount: number }[];
  donorNames?: string[];
  options?: string[];
  current?: string;
  draft?: ReceiptDraft;
};

type Msg = { id: string; role: "user" | "assistant"; text: string; card?: Card };

type SheetStep = "choose" | "camera" | "draft";

type ReceiptDraft = {
  vendor?: string;
  items?: { note: string; amount: number }[];
  total?: number;
  categoryId?: string | null;
};

type Cat = { id: string; name: string; flexible?: boolean };

type Snapshot = {
  hasGeminiKey?: boolean;
  safeToSpend: number;
  spentToday: number;
  reminderHour?: number;
  recurringCommitted?: number;
  recurring?: { id: string; name: string; amount: number }[];
  stack: { pct: number; blocks: number; streakDays: number };
};

const peso = (n: number) =>
  `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** "2027-03-30" → "March 2027". */
const monthLabel = (day: string) => {
  const [y, m] = day.split("-").map(Number);
  if (!y || !m) return day;
  return new Date(y, m - 1, 1).toLocaleDateString("en-PH", { month: "long", year: "numeric" });
};

export default function ChatHome() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [cats, setCats] = useState<Cat[]>([]);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [adjusting, setAdjusting] = useState<Card | null>(null);
  const [sheet, setSheet] = useState<SheetStep | null>(null);
  const [pendingDraft, setPendingDraft] = useState<ReceiptDraft | null>(null);
  /** Message ids whose schedule draft has already been switched on. */
  const [scheduledOn, setScheduledOn] = useState<Record<string, boolean>>({});
  const feedRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(() => {
    fetch("/api/budget")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        setSnap(d);
        if (d?.categories) setCats(d.categories);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    let alive = true;

    void (async () => {
      // 1. Scheduled payments land before anything renders, so the hero number
      //    already includes today's charge. The server call is idempotent.
      await fetch("/api/recurring", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "run" }),
      }).catch(() => {});

      // 2. Budget snapshot, which also carries the reminder hour.
      const snapshot: Snapshot | null = await fetch("/api/budget")
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      if (!alive) return;
      if (snapshot) {
        setSnap(snapshot);
        // 3. Evening check-in at the hour chosen in Setup (server dedupes per day).
        const hour = typeof snapshot.reminderHour === "number" ? snapshot.reminderHour : 19;
        if (new Date().getHours() >= hour) {
          fetch("/api/nudge", { method: "POST" }).catch(() => {});
        }
      }

      // 4. Sunday morning: auto weekly analysis (server skips if already done).
      const clock = new Date();
      if (clock.getDay() === 0 && clock.getHours() < 12) {
        fetch("/api/insights?auto=1", { method: "POST" }).catch(() => {});
      }

      // 5. History last, so it includes anything posted above.
      await fetch("/api/chat")
        .then((r) => (r.ok ? r.json() : { messages: [] }))
        .then((d) => {
          if (!alive) return;
        const rows: Msg[] = (d.messages ?? [])
          .filter((m: { kind: string }) => m.kind === "text" || m.kind === "log_card" || m.kind === "nudge")
          .map(
            (m: {
              id: string;
              role: "user" | "assistant";
              payload: {
                text?: string;
                before?: number;
                after?: number;
                txId?: string;
                plan?: Omit<Card, "type">;
                recurring?: Omit<Card, "type">;
              };
            }) => ({
              id: m.id,
              role: m.role,
              text: m.payload?.text ?? "",
              card:
                m.payload?.before !== undefined
                  ? {
                      type: "log_card" as const,
                      before: m.payload.before,
                      after: m.payload.after,
                      txId: m.payload.txId,
                    }
                  : m.payload?.plan
                    ? { ...m.payload.plan, type: "plan_draft" as const }
                    : m.payload?.recurring
                      ? { ...m.payload.recurring, type: "recurring_draft" as const }
                      : undefined,
            })
          );
        setMessages(rows);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
    })();

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  function pushAssistant(reply: string, cards: Card[] | undefined) {
    const first: Msg = { id: safeUuid(), role: "assistant", text: reply };
    if (cards?.length) {
      first.card = cards[0];
      setMessages((m) => [
        ...m,
        first,
        ...cards.slice(1).map((c) => ({ id: safeUuid(), role: "assistant" as const, text: "", card: c })),
      ]);
    } else {
      setMessages((m) => [...m, first]);
    }
  }

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    setBusy(true);
    setMessages((m) => [...m, { id: safeUuid(), role: "user", text: message }]);
    setInput("");
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      if (res.ok) {
        const data = await res.json();
        pushAssistant(data.reply, data.cards);
      } else {
        pushAssistant("That didn't go through. Check your connection and try again.", undefined);
      }
    } catch {
      pushAssistant("You seem to be offline. The message wasn't sent.", undefined);
    }
    setBusy(false);
    refresh();
  }

  /**
   * The one tap that turns a spoken rhythm into a schedule. The chat only ever
   * offers it. Writing it needs this deliberate press.
   */
  async function turnOnSchedule(msgId: string, card: Card) {
    if (!card.categoryId) {
      pushAssistant("I need a category to charge it to. Set one up in Setup first.", undefined);
      return;
    }
    setBusy(true);
    const res = await fetch("/api/recurring", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: card.name,
        amount: card.amount,
        categoryId: card.categoryId,
        cadence: card.cadence,
        weekdays: card.weekdays,
        dayOfMonth: card.dayOfMonth,
      }),
    });
    setBusy(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      pushAssistant(data.error ?? "That schedule didn't save.", undefined);
      return;
    }
    setScheduledOn((s) => ({ ...s, [msgId]: true }));
    const posted = data.posted as { name: string; count: number; total: number }[] | undefined;
    pushAssistant(
      posted?.length
        ? posted[0].count > 1
          ? `${posted[0].name} is on the calendar: ${posted[0].count} days were missing, so I caught them up (${peso(
              posted[0].total
            )}). From here it lands on its own.`
          : `${card.name} is on the calendar, and today's charge is already in. It lands on its own from here.`
        : `${card.name} is on the calendar. Nothing was due yet. It starts with the next one.`,
      undefined
    );
    refresh();
  }

  async function pickCategory(txId: string, categoryName: string) {
    const cat = cats.find((c) => c.name === categoryName);
    if (!cat) return;
    await fetch("/api/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "correctCategory", txId, categoryId: cat.id }),
    });
    setMessages((m) =>
      m.map((msg) =>
        msg.card?.type === "clarify_chip" && msg.card.txId === txId
          ? { ...msg, card: undefined, text: `${msg.text}. Sorted.` }
          : msg
      )
    );
    refresh();
  }

  function startVoice() {
    type SR = {
      lang: string;
      interimResults: boolean;
      start(): void;
      onresult: ((e: { results: { 0: { 0: { transcript: string } } } }) => void) | null;
      onend: (() => void) | null;
      onerror: (() => void) | null;
    };
    const w = window as unknown as { webkitSpeechRecognition?: new () => SR; SpeechRecognition?: new () => SR };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) {
      pushAssistant("Voice input needs Safari or Chrome on your phone. Typing works the same.", undefined);
      return;
    }
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.onresult = (e) => {
      const transcript = e.results[0][0].transcript;
      setInput((prev) => (prev ? `${prev} ${transcript}` : transcript));
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    setListening(true);
    rec.start();
  }

  async function onReceipt(file: File) {
    if (!file) return;
    setBusy(true);
    try {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      const res = await fetch("/api/receipt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: btoa(binary), mime: file.type }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPendingDraft(null);
        setSheet("choose");
        setSheetError(data.error ?? "That receipt didn&apos;t come through. Type what you spent instead.");
      } else {
        const d: ReceiptDraft = data.draft;
        setPendingDraft(d);
        setSheet("draft");
      }
    } catch {
      setSheetError("The camera capture failed. You can try again or type what you spent instead.");
      setSheet("choose");
    }
    setBusy(false);
  }

  async function approveReceipt(draft: ReceiptDraft) {
    setBusy(true);
    const res = await fetch("/api/receipt", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draft }),
    });
    setBusy(false);
    if (res.ok) {
      setSheet(null);
      setPendingDraft(null);
      pushAssistant("Logged. I&apos;ll deduct each item so your history stays granular.", undefined);
      refresh();
    } else {
      setSheetError("The approval didn&apos;t save. Try once more.");
    }
  }

  const sts = snap?.safeToSpend ?? 0;
  const userHasKey = snap?.hasGeminiKey ?? false;
  const [sheetError, setSheetError] = useState<string | null>(null);

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-5 pt-5">
        <span className="micro">BudgetFlow</span>
        <Link
          href="/app/guide"
          className="inline-flex items-center gap-1.5 text-[13px] font-medium"
          style={{ color: "var(--ink-2)" }}
        >
          <BookIcon size={15} />
          Tutorial
        </Link>
      </div>

      {/* Hero: the one number */}
      <section className="rise px-6 pb-5 pt-4 text-center">
        <p className="text-[13px] font-medium tracking-[0.01em] text-[var(--ink-2)]">Safe to spend today</p>
        <h1 className="hero-num mt-2">{peso(sts)}</h1>
        <p className="sub num mt-3">
          {snap
            ? `${peso(snap.spentToday)} spent today, ${snap.stack.streakDays} day${snap.stack.streakDays === 1 ? "" : "s"} on pace`
            : "\u00A0"}
        </p>
        {Boolean(snap?.recurringCommitted) && (
          <p className="micro num mt-1.5">
            {peso(snap!.recurringCommitted!)} more is due to scheduled payments before the month ends
          </p>
        )}
        <CashPile pct={snap?.stack.pct ?? 1} size="sm" />
      </section>

      {/* Feed */}
      <div ref={feedRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-4">
        {loaded && messages.length === 0 && (
          <div className="card mx-auto max-w-[85%] p-5 text-center">
            <p className="text-[15px] leading-relaxed">
              Say what you spent, the moment you spend it. “Coffee 180” is enough. I&apos;ll sort the
              category, pace the month, and guard your savings.
            </p>
            <Link
              href="/app/guide"
              className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium"
              style={{ color: "var(--accent)" }}
            >
              <BookIcon size={14} />
              New here? See how it works
            </Link>
          </div>
        )}
        {!loaded && <p className="micro px-2 text-center">Loading your conversation…</p>}

        {messages.map((m) => (
          <div key={m.id} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div
              className={
                m.role === "user"
                  ? "max-w-[85%] rounded-[18px] rounded-br-md px-4 py-2.5 text-[15px] leading-snug text-white"
                  : "card max-w-[85%] rounded-[18px] rounded-bl-md px-4 py-2.5 text-[15px] leading-snug"
              }
              style={m.role === "user" ? { background: "var(--accent)" } : undefined}
            >
              {m.text}
              {m.card?.type === "log_card" && m.card.before !== undefined && (
                <p className="micro num mt-1.5">
                  Safe to spend {peso(m.card.before ?? 0)} to {peso(m.card.after ?? 0)}
                </p>
              )}
              {m.card?.type === "tradeoff_card" && (
                <div className="mt-2.5 rounded-[10px] border border-[var(--hairline)] p-3 text-[13px]">
                  <p className="warn-text font-semibold">Trade-off</p>
                  {m.card.moves?.map((mv, i) => (
                    <p key={i} className="mt-1 num">
                      {mv.from} −{peso(mv.amount)}
                    </p>
                  ))}
                  {m.card.partial && (
                    <p className="micro mt-1">Other categories couldn&apos;t cover all of it.</p>
                  )}
                  {!m.card.partial && (
                    <button className="chip mt-2.5 inline-flex items-center gap-1.5" onClick={() => setAdjusting(m.card!)}>
                      <SwapIcon size={13} />
                      Move it differently
                    </button>
                  )}
                </div>
              )}
              {m.card?.type === "clarify_chip" && (
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {m.card.options?.map((o) => (
                    <button key={o} className="chip" onClick={() => pickCategory(m.card!.txId!, o)}>
                      {o}
                    </button>
                  ))}
                </div>
              )}
              {m.card?.type === "receipt_draft" && m.card.draft && (
                <button className="btn-primary mt-3 w-full py-2.5 text-sm" onClick={() => approveReceipt(m.card!.draft!)}>
                  Approve and log
                </button>
              )}
              {m.card?.type === "recurring_draft" && (
                <div className="mt-2.5 rounded-[10px] border border-[var(--hairline)] p-3">
                  <p className="micro">On a rhythm</p>
                  <p className="num mt-1 text-[15px] font-semibold">
                    {m.card.name} · {peso(m.card.amount ?? 0)}
                  </p>
                  <p className="micro num mt-0.5">
                    {m.card.needsDays ? "the days you choose" : m.card.when}
                    {m.card.monthlyEstimate
                      ? ` · about ${peso(m.card.monthlyEstimate)} a month`
                      : ""}
                    {m.card.categoryName ? ` · from ${m.card.categoryName}` : ""}
                  </p>
                  {scheduledOn[m.id] ? (
                    <Link
                      href="/app/plans"
                      className="chip mt-3 inline-flex items-center gap-1.5"
                    >
                      <RepeatIcon size={13} />
                      Scheduled
                    </Link>
                  ) : m.card.needsDays ? (
                    <Link
                      href="/app/plans"
                      className="btn-primary mt-3 inline-flex w-full items-center justify-center gap-2 py-2.5 text-sm"
                    >
                      <RepeatIcon size={15} />
                      Pick the days
                    </Link>
                  ) : (
                    <button
                      className="btn-primary mt-3 inline-flex w-full items-center justify-center gap-2 py-2.5 text-sm"
                      disabled={busy}
                      onClick={() => turnOnSchedule(m.id, m.card!)}
                    >
                      <RepeatIcon size={15} />
                      Switch it on
                    </button>
                  )}
                </div>
              )}
              {m.card?.type === "plan_draft" && (
                <div className="mt-2.5 rounded-[10px] border border-[var(--hairline)] p-3">
                  <p className="micro">Plan</p>
                  <p className="num mt-1 text-[15px] font-semibold">{m.card.name}</p>
                  <p className="micro num mt-0.5">
                    {peso(m.card.targetAmount ?? 0)}
                    {m.card.deadline ? ` by ${monthLabel(m.card.deadline)}` : ""}
                    {m.card.monthlySetAside ? ` · ${peso(m.card.monthlySetAside)} a month` : ""}
                  </p>
                  <Link
                    href={`/app/plans?name=${encodeURIComponent(m.card.name ?? "")}&target=${
                      m.card.targetAmount ?? 0
                    }&monthly=${m.card.monthlySetAside ?? 0}&deadline=${m.card.deadline ?? ""}`}
                    className="btn-primary mt-3 inline-flex w-full items-center justify-center gap-2 py-2.5 text-sm"
                  >
                    <TargetIcon size={15} />
                    Set it up
                  </Link>
                </div>
              )}
            </div>
          </div>
        ))}
        {busy && <p className="micro px-2">Writing it down…</p>}
      </div>

      {/* Composer */}
      <div
        className="shrink-0 border-t px-3 pb-3 pt-2.5 backdrop-blur-xl"
        style={{ borderColor: "var(--hairline)", background: "var(--surface)" }}
      >
        <div className="flex items-center gap-2">
          <button
            className={`icon-btn shrink-0 ${listening ? "warn-text" : ""}`}
            style={listening ? { borderColor: "var(--warn)" } : undefined}
            onClick={startVoice}
            aria-label={listening ? "Listening" : "Dictate a message"}
          >
            <MicIcon />
          </button>
          <input
            className="input min-w-0 flex-1"
            placeholder="Coffee 180, or ask me anything"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send(input)}
            enterKeyHint="send"
          />
          <button
            className="icon-btn shrink-0"
            aria-label="Log a receipt"
            onClick={() => {
              setSheetError(null);
              setSheet("choose");
            }}
          >
            <ReceiptIcon />
          </button>
          <button
            className="icon-btn shrink-0"
            style={{ color: "var(--accent)", borderColor: "var(--accent)" }}
            aria-label="Send"
            onClick={() => send(input)}
            disabled={busy || !input.trim()}
          >
            <SendIcon />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && onReceipt(e.target.files[0])}
          />
        </div>
      </div>

      {adjusting && (
        <AdjustSheet
          card={adjusting}
          cats={cats}
          onClose={() => setAdjusting(null)}
          onDone={(msg) => {
            setAdjusting(null);
            pushAssistant(msg, undefined);
            refresh();
          }}
        />
      )}

      {sheet && (
        <ReceiptSheet
          step={sheet}
          draft={pendingDraft}
          error={sheetError}
          busy={busy}
          hasKey={Boolean(userHasKey)}
          onPickCamera={() => {
            setSheetError(null);
            setSheet("camera");
            requestAnimationFrame(() => fileRef.current?.click());
          }}
          onPickFile={(f) => {
            setSheetError(null);
            setSheet("camera");
            onReceipt(f);
          }}
          onClose={() => {
            setSheet(null);
            setPendingDraft(null);
            setSheetError(null);
          }}
          onApprove={approveReceipt}
        />
      )}
    </main>
  );
}

// The home-screen money visual now lives in src/components/CashPile.tsx.

function AdjustSheet({
  card,
  cats,
  onClose,
  onDone,
}: {
  card: Card;
  cats: Cat[];
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const donors = cats.filter(
    (c) =>
      c.flexible &&
      c.id !== card.moves?.[0]?.fromId &&
      !card.moves?.some((mv) => mv.fromId === c.id)
  );
  const overshoot = card.overshoot ?? 0;
  const [alloc, setAlloc] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const remainingById = new Map(cats.map((c) => [c.id, c]));
  const total = Object.values(alloc).reduce((s, v) => s + (Number(v) || 0), 0);
  const left = overshoot - total;

  async function submit() {
    setBusy(true);
    setError(null);
    const moves = Object.entries(alloc)
      .filter(([, v]) => Number(v) > 0)
      .map(([fromCategoryId, v]) => ({ fromCategoryId, amount: Number(v) }));
    const res = await fetch("/api/tradeoffs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ txId: card.txId, moves }),
    });
    setBusy(false);
    const data = await res.json();
    if (!res.ok) return setError(data.error ?? "That didn't save.");
    onDone(`Done. ${moves
      .map((m) => `${peso(m.amount)} from ${remainingById.get(m.fromCategoryId)?.name ?? "a category"}`)
      .join(" and ")} covers the ${peso(overshoot)}.`);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end backdrop-blur-[2px]" style={{ background: "var(--scrim)" }} onClick={onClose}>
      <div
        className="card-solid mx-auto mb-4 w-full max-w-md rounded-b-[28px] p-6"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Adjust trade-off"
      >
        <h3 className="text-lg font-bold">Move {peso(overshoot)} differently</h3>
        <p className="sub mt-1 text-sm">
          The total has to stay {peso(overshoot)}, the same amount that was overspent. Savings stay locked.
        </p>
        <div className="mt-4 space-y-3">
          {donors.map((c) => (
            <label key={c.id} className="flex items-center justify-between gap-3">
              <span className="text-[15px] font-medium">{c.name}</span>
              <input
                inputMode="decimal"
                placeholder="0"
                value={alloc[c.id] ?? ""}
                onChange={(e) => setAlloc({ ...alloc, [c.id]: Number(e.target.value) || 0 })}
                className="field num w-28 text-right"
              />
            </label>
          ))}
        </div>
        <p className={`micro mt-3 num ${Math.abs(left) < 0.01 ? "good-text" : ""}`}>
          {left > 0.01 ? `${peso(left)} still to assign` : left < -0.01 ? `${peso(-left)} over the total` : "Fully assigned"}
        </p>
        {error && <p className="warn-text mt-2 text-sm">{error}</p>}
        <button className="btn-primary mt-4 w-full" onClick={submit} disabled={busy || Math.abs(left) > 0.01}>
          <span className="inline-flex items-center gap-2">
            <CheckIcon size={15} />
            Confirm move
          </span>
        </button>
        <button className="btn-ghost mt-2.5 w-full" onClick={onClose}>
          Keep the automatic split
        </button>
      </div>
    </div>
  );
}

function ReceiptSheet({
  step,
  draft,
  error,
  busy,
  hasKey,
  onPickCamera,
  onPickFile,
  onClose,
  onApprove,
}: {
  step: SheetStep;
  draft: ReceiptDraft | null;
  error: string | null;
  busy: boolean;
  hasKey: boolean;
  onPickCamera: () => void;
  onPickFile: (f: File) => void;
  onClose: () => void;
  onApprove: (d: ReceiptDraft) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end"
      style={{ background: "var(--scrim)" }}
      onClick={onClose}
    >
      <div
        className="card-solid mx-auto mb-4 w-full max-w-md rounded-b-[28px] p-6"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Receipt check"
      >
        {step === "choose" && (
          <>
            <div className="flex items-center gap-3">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-full" style={{ background: "var(--paper-2)", color: "var(--ink-2)" }}>
                <ReceiptIcon size={17} />
              </span>
              <h3 className="text-[17px] font-bold">Receipt check</h3>
            </div>
            <p className="sub mt-3 text-sm leading-relaxed">
              Snap the receipt and I&apos;ll read each line item with your Gemini key. Nothing is
              logged until you approve the draft.
            </p>
            {!hasKey && (
              <p className="warn-text mt-2 text-sm">
                No Gemini key yet. Add one in Setup first.
              </p>
            )}
            {error && <p className="warn-text mt-2 text-sm">{error}</p>}
            <button className="btn-primary mt-4 w-full" onClick={onPickCamera}>
              <span className="inline-flex items-center gap-2">
                <CameraIcon size={17} />
                Open camera
              </span>
            </button>
            <button className="btn-ghost mt-2.5 w-full" onClick={() => fileRef.current?.click()}>
              <span className="inline-flex items-center gap-2">
                <ImageIcon size={17} />
                Choose a photo
              </span>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && onPickFile(e.target.files[0])}
            />
            <button className="sub mt-3 w-full text-sm" onClick={onClose}>
              Not now
            </button>
          </>
        )}

        {step === "camera" && (
          <div className="py-6 text-center">
            <p className="sub">Reading the receipt…</p>
            <p className="micro mt-2">Line items stay private to your budget.</p>
          </div>
        )}

        {step === "draft" && draft && (
          <>
            <div className="flex items-center gap-3">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-full" style={{ background: "var(--paper-2)", color: "var(--ink-2)" }}>
                <ReceiptIcon size={17} />
              </span>
              <h3 className="text-[17px] font-bold">{draft.vendor ?? "Receipt"}</h3>
            </div>
            <div className="rows mt-4">
              {(draft.items ?? [{ note: "Total", amount: draft.total ?? 0 }]).map((it, i) => (
                <div key={i} className="flex items-center justify-between py-2.5 text-[15px]">
                  <span className="truncate pr-3">{it.note}</span>
                  <span className="num font-medium">{peso(it.amount)}</span>
                </div>
              ))}
              <div className="flex items-center justify-between py-2.5 text-[15px] font-bold">
                <span>Total</span>
                <span className="num">{peso(draft.total ?? 0)}</span>
              </div>
            </div>
            {error && <p className="warn-text mt-2 text-sm">{error}</p>}
            <button className="btn-primary mt-4 w-full" onClick={() => onApprove(draft)} disabled={busy}>
              {busy ? "Logging…" : "Approve and log"}
            </button>
            <button className="btn-ghost mt-2.5 w-full" onClick={onClose}>
              Discard
            </button>
          </>
        )}
      </div>
    </div>
  );
}
