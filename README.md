# BudgetFlow: The Zero-Sum Financial Co-Pilot

Mobile-first web app (Next.js 14 + TypeScript + Tailwind). One number (Safe-to-Spend), a rigid savings
floor, fluidly adaptive categories, conversational logging, scheduled payments, receipt check, money
stack streaks, view-only guardian links, bring-your-own Gemini key.

## Running now (dev/demo mode, no database needed)

```bash
npm install
npm run dev
```

Open on your phone/desktop at `http://localhost:3000`. A demo account is seeded on start:

```
username: jumong09
password: jumong09
```

Data lives in an in-memory store, so a restart resets it. That is fine while your DCISM MariaDB is
offline: `db/schema.sql` and the MariaDB store are ready, they just have no credentials.

Or register a new account to walk the onboarding (income, fixed costs, hard savings, categories,
then an optional Gemini API key, validated before saving).

Try in chat:

- `Spent ₱140 on groceries` logs a transaction and shows the before and after Safe-to-Spend
- `Got refunded ₱40 for the shoes` logs a refund, Safe-to-Spend rises immediately
- `Can I afford ₱150 shoes?` answers with the real consequence before you commit
- `I pay ₱100 for transport every Mon, Wed and Fri` turns a rhythm into a scheduled payment
- `I'm saving up for a laptop, ₱45,000 by March` becomes a plan with a monthly set-aside

If the Gemini key is missing, invalid, or out of quota, the app falls back to a regex parser and
templated replies. Logging never breaks.

## Going live on MariaDB (DCISM servers)

1. Run `db/schema.sql` on your MariaDB instance.
2. Copy `.env.example` to `.env.local`, fill `MARIADB_*`, set `JWT_SECRET` (long random string) and
   `DATA_ENC_KEY` (32 bytes hex, encrypts users' Gemini keys at rest).
3. Restart. The store selector switches from memory to MariaDB on its own.

## Checks

```bash
npm test     # 79 engine tests (money math, plans, schedules, intent parsing, fallback parser)
npm run check  # tsc + tests + production build
```

## Architecture

- `../docs/passby.md` starts with how to think on this codebase: the contract, the design rules, environment traps, and open landmines
- `../docs/ROADMAP.md` tracks milestones, risk, and the decisions log
- `src/lib/engine/` deterministic math: Safe-to-Spend, zero-sum trade-offs, plans, scheduled payments, intent parsing, money stack (an LLM never does budget math)
- `src/lib/store/` the `DataStore` interface, with MariaDB and in-memory implementations
- `src/lib/ai/` Gemini REST wrapper (JSON mode), the exact system prompts, graceful fallback
- `src/app/api/` auth, onboarding, budget, chat, transactions, receipt, plans, recurring, insights, nudge, trade-offs, guardian, key status
- `src/app/app/` chat home (hero + composer with mic and receipt check), plans, history, insights, setup
- `src/app/guide/` the tutorial, which runs the real trade-off engine in a live sandbox

## Deliberately out of scope (V1)

Bank sync, community, pie-chart dashboards, receipt OCR as a hard dependency, real-time guardian
alerts. See `../docs/passby.md` section 1 for why each one is barred rather than merely postponed.
