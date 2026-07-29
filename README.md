# Warehouse & Sales Management System

Warehouse stock, order lifecycle, customer receivables, operating expenses and
management analytics for a toy manufacturing and export factory in Uzbekistan.
Replaces the Excel workbooks the factory runs on today.

Built to **Tech Spec v2.0**. Section references throughout the code (`§6`,
`BR-2`, …) point at that document.

**Stack:** Next.js 16 (App Router) · PostgreSQL 16 · Drizzle ORM · Tailwind ·
Docker Compose. Trilingual UI: Uzbek (Latin, default), Russian, English.

---

## Getting started

Prerequisites: Node 22, and Docker (for PostgreSQL) or a local PostgreSQL 16.

```bash
npm install
cp .env.example .env       # set AUTH_SECRET; the defaults work for local dev
npm run setup              # starts PostgreSQL, applies migrations, seeds
npm run dev                # http://localhost:3000
```

Sign in with the Director account from `.env`
(`SEED_DIRECTOR_LOGIN` / `SEED_DIRECTOR_PASSWORD`, default `director` /
`director12345`).

For deployment, HTTPS, backups and rollback, see **[docs/RUNBOOK.md](docs/RUNBOOK.md)**.

---

## The five ideas that shape this codebase

Everything else follows from these.

### 1. Stock is a ledger, never a number you edit

`stock_movements` is append-only. On-hand is the sum of its signed deltas;
`product_stock` caches that sum for fast reads and is rebuildable from the
ledger at any time (`recomputeStock`). Nothing writes a quantity directly, so
stock cannot silently drift — the most common inventory-system bug.

### 2. Reservation happens on acceptance, under a row lock

§6 is the heart of the spec: reservation is created when the warehouseman
**accepts** an order, not when it is created (BR-1, BR-2). Every reservation
path locks the product's `product_stock` row `FOR UPDATE` before reading
Available, and locks multiple products in sorted order so concurrent multi-line
orders cannot deadlock. That is what makes BR-9 true rather than hoped-for, and
it is covered by a test that fires six simultaneous acceptances at 100 units and
asserts exactly 100 get reserved.

### 3. Money is integer cents

Every monetary column is an integer count of cents. No floats, no numeric
strings to parse, so revenue, COGS, profit and break-even are exact. `lib/money.ts`
owns the conversions at the form and import boundaries.

### 4. Roles are enforced by removing data, not hiding it

§2.2 says responses to non-Director clients must not *contain* cost, price,
profit or expense data. So `lib/dto.ts` builds role-scoped projections in which
forbidden fields are **absent from the object**, not merely unrendered.
`lib/dto.test.ts` walks the real query payloads for each role and fails on any
key that looks like money — including fields nobody has written yet.

### 5. Nothing is translated at render time

English is the typed reference dictionary, so a missing Uzbek or Russian key is a
compile error. 697 keys, complete in all three languages, with tests for blank
values, dropped `{placeholders}` and the enum keys the UI builds by
concatenation. Switching language rewrites a cookie in a Server Action, which
re-renders server components while React preserves client state — so a
half-filled form survives the switch (§13).

---

## What is implemented

**Phase 1 — foundation.** Auth with bcrypt and a sliding inactivity window;
Director / Warehouseman / Salesperson roles; the trilingual shell; product cards
with cost, market and export prices, packing, dimensions and images; the stock
overview with on-hand / reserved / available as three columns; goods receipt;
Excel import with per-row validation and a preview; Settings.

**Phase 2 — orders and the warehouse workflow.** Order creation with price-type
selection and per-line override; the §5.3 status machine; reservation on
acceptance with explicit top-up after a receipt (BR-5); the warehouse queue with
§7.1 green/yellow/red availability; the consolidated "to produce" shortfall list;
the §7.4 picking summary; picking-list and proforma exports.

**Phase 3 — customers and money.** Customer cards with channels, default price
types and the §8.2 A–D grades derived from real payment history; partial
payments; credit terms and due dates; receivables with aging buckets; deadline
control; returns that restore stock and correct both debt and profit.

**Phase 4 — expenses and analytics.** Operating expenses with fixed/variable
categories, receipt photos and recurring templates; the Director dashboard with
the §9.4 P&L and break-even widget; all seven §10.3 reports; ABC/XYZ; frozen
stock with one-step repricing; inventory counts; the §12 audit log.

Out of scope in v1, per §1.3: accounting/1C integration, production planning,
barcode scanning, multiple warehouses, offline mode.

---

## Judgement calls worth knowing about

The spec left some things open. Where a decision was needed, this is what was
decided and why.

**Frozen stock for a product that has never sold.** §4.3 measures days since the
last sale, which does not exist for a product that has never sold. Using "no sale
date" as frozen would flag every newly received product on day one. Age in the
warehouse stands in instead, so a product received today is Normal and one that
has sat unsold for four months is Frozen.

**ABC boundaries.** A product is class A when it falls inside the *first* 80% of
cumulative revenue. Classifying on the cumulative share *after* each product
would demote the single biggest seller to B whenever it alone exceeded 80% — the
opposite of what §4.4 means.

**Break-even at a non-positive margin** returns nothing rather than a number. No
revenue volume covers fixed costs at a zero or negative margin, so the dashboard
says so in words instead of printing a figure.

**Period attribution.** A sale belongs to the period it shipped in; a return to
the period it came back in. Reversing a June sale in July therefore reduces July
and leaves June's signed-off figures alone.

**Overpayment is refused.** Recording more than the outstanding balance is almost
always a typo, and accepting it would put receivables into negative numbers.

**Recurring expenses refuse to generate twice** for the same month, and say how
many matching entries they found. Silently double-posting fixed costs would
corrupt both the P&L and break-even.

**Stock value dynamics uses today's cost price.** The system keeps one cost per
product with no history, so the report answers "what would that stock be worth at
current cost", not a restatement of the past. Quantities are historically exact,
from the ledger.

---

## Layout

```
src/
  db/schema.ts            the data model (Appendix A)
  lib/
    stock.ts              the ledger and the reservation engine (§6)
    orders.ts             order lifecycle and status machine (§5, §7)
    payments.ts           balances (§5.4)
    returns.ts            returns (§11)
    analytics.ts          P&L, break-even, ABC/XYZ, frozen (§4.3, §4.4, §9.4, §10)
    money.ts              integer-cent arithmetic
    dto.ts                role-scoped projections + the leak detector (§2.2)
    permissions.ts        the §2.2 matrix, in one place
    audit.ts              the §12 trail
    import.ts             Excel import (§14)
    export/               one document shape -> XLSX and PDF
    queries/              read models per module
  i18n/                   dictionaries and formatting (§13)
  app/(app)/              the authenticated application
  proxy.ts                coarse auth gate — not the security boundary
```

Fine-grained authorization lives in every page and Server Action, never only in
`proxy.ts`: Server Actions are reachable by direct POST, so each one re-checks.

---

## Scripts

| Command | What it does |
|---|---|
| `npm run setup` | Local bootstrap: PostgreSQL + migrate + seed |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / serve |
| `npm run lint` | ESLint |
| `npm test` | The full suite (103 tests) against a real PostgreSQL |
| `npm run db:generate` | Generate a migration from schema changes |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:seed` | Seed reference data and the first Director (idempotent) |
| `bash scripts/backup.sh` | Take a database backup now |
| `bash scripts/restore.sh` | List or restore backups |

---

## Tests

`npm test` runs against a real PostgreSQL, because the guarantees that matter
most — row-level locking, transactional rollback, exact money arithmetic — cannot
be demonstrated against a mock. The suites map onto the §17 acceptance criteria:

| Suite | Covers |
|---|---|
| `lib/stock.test.ts` | The ledger and BR-1…BR-9, including concurrent acceptance |
| `lib/orders.test.ts` | The six named Phase 2 scenarios (a)–(f) and the status machine |
| `lib/money-flow.test.ts` | Partial payments, overdue on day +1, returns |
| `lib/analytics.test.ts` | The Phase 4 hand-calculated month, break-even, ABC/XYZ |
| `lib/dto.test.ts` | §2.2: no money in any non-Director payload |
| `i18n/i18n.test.ts` | §13: three complete languages, placeholders, formats |
| `lib/export/export.test.ts` | XLSX and PDF output, including Cyrillic filenames |
| `lib/sql.test.ts` | Correlated-subquery correctness |

`scripts/smoke.mjs` drives a real browser through the main flows against a
running server — useful when demonstrating acceptance:

```bash
npm run build && npm start &
node scripts/smoke.mjs
```
