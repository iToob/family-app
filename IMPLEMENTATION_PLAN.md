# Implementation plan and architecture

## Stack

| Layer | Choice | Notes |
|---|---|---|
| App | Next.js 15 (App Router), React 19, TypeScript (strict) | Server components for pages, server actions for every mutation |
| Styling | Tailwind CSS 4, self-hosted fonts (Bricolage Grotesque, Public Sans) | Hand-built accessible components instead of shadcn/ui (see departures) |
| Database | PostgreSQL 14+ | Integrity rules enforced in the database, not just in code |
| ORM | **Drizzle ORM** + node-postgres | Departure from Prisma (see below) |
| Validation | Zod at the action boundary, domain checks in services | |
| Auth | Username + password, Argon2id (`@node-rs/argon2`), DB-backed sessions | Departure from Auth.js (see below) |
| Tests | Vitest (domain and financial logic against a real Postgres), Playwright (E2E) | |
| Hosting | Vercel + any managed Postgres; daily Vercel Cron | |

### Departures from the recommended stack

- **Drizzle instead of Prisma.** Prisma needs native engine binaries downloaded at install time. Drizzle is pure TypeScript and produces plain SQL migrations. That made it easy to add database triggers (append-only ledger, non-negative balance) and explicit `SELECT … FOR UPDATE` row locks, which are central to the financial model. It also means smaller serverless bundles and no binary-target problems on Vercel.
- **Custom session auth instead of Auth.js.** Auth.js's credentials provider is designed around JWT sessions and discourages password login. A small, auditable module with Argon2id, hashed session tokens in Postgres, rate limiting and parent-controlled recovery is simpler and fits a five-person household better. Sessions can be revoked server-side (password change, archive).
- **No shadcn/ui CLI.** Components are hand-written with Tailwind to keep the dependency surface small and the look specific to this app.

## Code layout

```
src/
  db/schema.ts          All tables, enums, indexes (Drizzle)
  db/index.ts           Connection pool, transaction types
  lib/money.ts          Integer Points↔cents conversion, AUD formatting
  lib/time.ts           Timezone-aware calendar maths (recurrence, periods)
  server/core.ts        Actor, errors, audit, notifications, row locks, balances, ledger posting, holds
  server/jobs.ts        Opportunities, occurrences, claims, submissions, approvals, proposals
  server/marketplace.ts Items, purchases, fulfilment, refunds, entitlements, subscriptions and billing
  server/money-ops.ts   Cash-out, savings goals, awards, direct spends, corrections
  server/household.ts   Setup, members, participation, charter, settings, disputes, maintenance
  server/auth.ts        Login, sessions, rate limiting, viewer/preview context
  server/queries.ts     Read models for pages and reports
  app/actions.ts        Server actions: session → zod → domain service
  app/(child)/…         Participant screens (Home, Earn, Spend, Wallet, More)
  app/admin/…           Parent screens (Dashboard, Inbox, Jobs, Shop, Economy, Settings)
  app/api/…             CSV export, photo serving, cron endpoint
drizzle/                SQL migrations (0001 adds triggers and CHECK constraints)
scripts/                migrate, seed-demo, reset-db, reconcile, run-maintenance, reset-password
tests/unit              Vitest suite (runs against a real Postgres)
tests/e2e               Playwright suite
```

Separation: **UI** (pages/components) → **actions** (session + input parsing) → **domain services** (authorisation, business rules, transactions) → **persistence** (Drizzle schema plus database constraints). Pages never write; actions never contain business rules.

## Financial transaction model

- **Points are integers. Money is integer AUD cents.** The exchange rate is stored as integer *cents per Point* (10 means 10 Points = $1), so conversion is one integer multiplication. No floats anywhere in financial paths.
- **The ledger (`points_ledger_entry`) is the only source of truth.** It is append-only: database triggers reject `UPDATE`, `DELETE` and `TRUNCATE`. Errors are fixed with visible `CORRECTION` entries (optionally linked via `reverses_entry_id`, which is unique, so an entry can only be reversed once).
- **Balances are derived, never stored:**
  `ledger = Σ entries`, `held = Σ active holds`, `saved = Σ savings allocations`, `available = ledger − held − saved`.
- **No negative balances**, enforced twice: in code (available-balance checks under lock) and by a database constraint trigger that rejects any ledger insert leaving a member's sum below zero.
- **Exactly-once posting.** Every entry has a unique `idempotency_key` derived from the business event (`job:<claimId>`, `purchase:<id>`, `cashout:<id>`, `sub:<id>:<periodStart>`, `refund:<id>`, `adjustment:<id>`). Retries, double-clicks and concurrent approvals can't create Points.
- **Concurrency.** Every operation that affects a member's available Points runs in a transaction and first takes `SELECT … FOR UPDATE` on that member's row. Claims lock the occurrence row; approvals lock the claim row; billing locks the subscription row. Maintenance runs take a per-household advisory lock.
- **Holds** reserve Points for pending purchases, cash-outs and pending debit corrections. Approval *captures* the hold and posts the debit in the same transaction. Rejection or cancellation *releases* it.
- **Cash conversion** snapshots the rate and AUD amount on the request. The debit is posted only when a parent records the payment (a CHECK constraint ties `aud_cents = −points × cents_per_point`).
- **Rate integrity.** Before go-live the rate is freely editable. After go-live it can only be raised, so earned Points are never devalued. Historical payouts keep their snapshot.

## Workflows

All of A–G in the brief are implemented end to end and covered by tests:

| Workflow | Unit test | E2E |
|---|---|---|
| A Earn | ✓ (+ concurrent approvals, auto-approval, parent-recorded) | ✓ |
| B Spend | ✓ (+ concurrency, idempotency, refunds, limits) | ✓ (parent-recorded) |
| C Cash | ✓ (+ concurrent payment, rate snapshot) | ✓ |
| D Insufficient | ✓ | ✓ |
| E Subscription | ✓ (+ retries, grace, lapse, pause) | |
| F Proposal | ✓ | |
| G Pause | ✓ | |

## Ambiguities resolved (simplest configurable choice)

- **"Kids can only view" (owner's instruction).** Added a household switch, *Kids can make requests*, which is **off by default**. Off: children see everything but cannot claim, request, cash out or move savings; parents use *Add Points*, *Record a spend* and *Record a job*. On: the full request/approval flows from the brief.
- **Paused participation:** can't claim new jobs or start subscriptions; can still spend or cash out existing balance; subscriptions pause automatically (configurable).
- **Partial payment** requires a reason. A "partial" equal to the full reward is treated as full approval.
- **Recurring jobs:** one occurrence per period in household time. When a new period starts, unclaimed earlier periods expire, but claimed work can still be finished and paid.
- **Projects:** "individual" means the first child to claim a milestone owns the project. "Collaborative" lets different children take different milestones.
- **Subscriptions:** the first period is charged on purchase. Renewal failure enters a grace period (retries daily), then lapses to *Unpaid*; paying restarts it from today. Turning off auto-renew ends it at the period end.
- **Corrections:** credits post immediately. Debits post immediately by default, or wait for the other parent if *Deductions need the other parent's approval* is on (Points are held meanwhile).
- **Budgets** are advisory warnings only and never block payment of commitments.
