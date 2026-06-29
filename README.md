# Toy Inventory & Sales Platform

Inventory and sales management across one central warehouse and four shops.
Track how much of each product exists, where it is, and (from Phase 2) who sold
what to whom and at what price.

Built with **Next.js (App Router) + PostgreSQL + Drizzle ORM**.

> **Note on the ORM:** the original plan named Prisma, but Prisma 7's engine
> binaries could not be downloaded reliably through the build proxy. We switched
> to **Drizzle** (pure TypeScript, no binary engines), which covers the same
> needs — typed schema, migrations, transactions — and removed the blocker.

## Core design principle — the stock ledger

Stock is **never edited directly**. Every quantity change (stock-in, transfer,
and later sales/voids) writes an immutable row to `stock_movements`. On-hand
stock for a `(product, location)` is the sum of its ledger deltas. A cached
`stock_balances` table is updated in the same transaction for fast reads and can
always be rebuilt from the ledger (`recomputeBalances`). This eliminates stock
drift — the most common inventory-system bug.

All stock changes funnel through `applyMovement` in `src/lib/stock.ts`.

## Roles (spec §2, §6)

| Role | Capabilities |
|---|---|
| **Admin** | Full access: products, prices, users, exchange rate, all stock & reports |
| **Warehouse** | Stock-in (supplier → warehouse), transfer (warehouse → shop), view warehouse + shop stock |
| **Sales Manager** | (Phase 2) record sales for own shop, manage customers; read-only view of other shops' stock |

Permissions live in one place — `src/lib/permissions.ts` — and are enforced
server-side on every mutation (the UI gating is only a convenience). Coarse
section gating also runs in `src/proxy.ts`.

## Getting started (local)

Prerequisites: Node 22, PostgreSQL 16 (local or via Docker).

```bash
cp .env.example .env          # adjust DATABASE_URL / AUTH_SECRET as needed
npm install
npm run db:migrate            # apply schema
npm run db:seed               # warehouse + 4 shops, regions/districts, admin, rate
npm run dev                   # http://localhost:3000
```

Default admin login (from `.env`): `admin@toy.local` / `admin12345`.

### Using Docker for Postgres only

```bash
docker compose up -d db
# then run migrate/seed/dev against it
```

### Full stack via Docker

```bash
docker compose up --build     # app on :3000, db on :5432
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run build` / `npm start` | Production build / serve |
| `npm run lint` | ESLint |
| `npm test` | Unit + integration tests (currency math, stock ledger) |
| `npm run db:generate` | Generate a migration from schema changes |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:seed` | Seed reference + initial data (idempotent) |
| `npm run db:studio` | Drizzle Studio |

## Project layout

```
src/
  db/
    schema.ts        # Drizzle schema (the data model)
    seed.ts, seed-data.ts
    index.ts         # db client
  lib/
    stock.ts         # the ledger: applyMovement / getOnHand / recompute
    currency.ts      # UZS/USD conversion + sale totals
    auth.ts          # password hashing, cookie session, role guards
    session.ts       # edge-safe JWT sign/verify (used by proxy)
    permissions.ts   # spec §6 permission matrix
    validation.ts    # shared zod schemas
    queries.ts       # server-side read queries
    import.ts        # bulk product import parse/validate
  components/        # UI primitives + forms
  app/
    login/           # auth
    (app)/           # authenticated shell
      dashboard/  products/  stock/  sales/  customers/
      admin/users/  admin/exchange-rate/
  proxy.ts           # auth + role gating (Next 16 "proxy" middleware)
```

## What's implemented

**Phase 1 — foundation**
- Auth (JWT cookie + bcrypt), role + shop scoping
- User management (admin)
- Product catalog CRUD (admin), derived `is_active` archive behavior, admin-only cost price
- **Bulk product import** — template download, upload, validate, preview with per-row errors, confirm-then-commit
- Stock ledger — **Stock-In** and **Transfer**, with negative-stock guards
- Stock-level views with role-aware visibility (sales managers don't see the warehouse column)

**Phase 2 — customers & sales**
- Admin-managed **exchange rate** (append-only history; each sale snapshots the active rate)
- **Customers** — shared list, search by name/phone, create (admin + manager), edit (admin), region→district pickers
- **New Sale** (`lib/sales.ts`) — per-sale currency (UZS/USD) with live suggested-price conversion, per-item price override, units-per-box→pcs helper, customer search / create-inline / "Other" one-time; atomic sale + `SALE_OUT` stock deduction (rolls back if short)
- **Void** — restores stock via `VOID_RETURN`, flips status, excluded from revenue (admin or the manager who made the sale)
- Sales history (manager: own shop; admin: all + shop filter) and on-screen sale summary with suggested-vs-actual variance

**Phase 3 — reporting** (`lib/reports.ts`, `lib/date-range.ts`)
- **Cash Position Dashboard** — per-shop UZS and USD collected, kept separate (what should be in each drawer); admin sees all shops side-by-side, manager sees own; voided sales excluded
- **Sales performance** — by shop / manager / product / customer, in a UZS-equivalent so cross-currency comparisons are apples-to-apples (each line converted via its sale's snapshot rate)
- **Discount/markup variance** — suggested vs actual totals by manager
- Date-range filter (today / this week / this month / custom), role-scoped (managers see only their own shop)

### Roadmap

- **Phase 4** — Excel/PDF export (respecting on-screen filters), deployment hardening

## Optional: SessionStart hook for Claude Code on the web

`scripts/session-setup.sh` brings a fresh environment to a runnable state
(starts Postgres, installs deps, migrates, seeds). To run it automatically at
the start of every Claude Code web session, add to `.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [ { "type": "command", "command": "bash scripts/session-setup.sh" } ] }
    ]
  }
}
```
