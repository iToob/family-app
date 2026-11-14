# Family Economy

A private web app for running your family's participation economy. Kids earn Points for useful work, then spend them in a family marketplace, save toward goals, or convert them to cash at a fixed rate. Parents govern everything, and every Point is accounted for in a permanent ledger.

It works in any browser on a computer, and installs to the home screen on iPhone and Android like a native app.

- **Architecture, financial model and design decisions:** [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)

---

## 1. Put it online (about 20 minutes, free tiers)

You need a GitHub account, a [Vercel](https://vercel.com) account and a hosted Postgres database. [Neon](https://neon.tech) is easiest and has a free tier; Vercel's Postgres integration is Neon underneath.

1. **Create the database.** In Neon, create a project in the *AWS Asia Pacific (Sydney)* region. Copy the connection string (it ends with `?sslmode=require`).
2. **Put the code on GitHub.** Create a private repository and push this folder to it.
3. **Import into Vercel.** *Add New → Project*, then pick the repository. Framework: Next.js (auto-detected).
4. **Set environment variables** in Vercel (*Settings → Environment Variables*):
   - `DATABASE_URL`: the Neon connection string
   - `SETUP_TOKEN`: a long random code you'll type once on the setup page
   - `CRON_SECRET`: another long random value (enables the daily billing job)
5. **Create the tables.** On your computer, in this folder:
   ```bash
   npm install
   DATABASE_URL="<your neon url>" npm run db:migrate
   ```
6. **Deploy** (Vercel does this on every push). Open your site. You'll land on **/setup**:
   enter the setup code, your household name, the exchange rate (default 10 Points = $1) and your own account.
7. **Finish setup** on the checklist screen: add the other parent and each child (username plus a temporary password; they choose their own on first sign-in), add some jobs and marketplace items, then **Go live**.
8. **Install on phones.**
   - *iPhone:* open the site in Safari, tap Share, then *Add to Home Screen*.
   - *Android:* open in Chrome, tap the menu, then *Install app*.

The daily job (recurring jobs, subscription billing, privilege expiry) is scheduled in `vercel.json` for 15:00 UTC (1 am Brisbane). It also runs whenever a parent opens the dashboard, and on demand from *Economy → Process due subscriptions now*. It's idempotent, so running it extra times never double-charges.

> After setup you can delete `SETUP_TOKEN` from Vercel. The setup page then refuses to run at all.

### Other hosts

Any Node 20+ host plus Postgres 14+ works (Railway, Render, Fly.io, a home server):
`npm ci && npm run db:migrate && npm run build && npm start`. Point any scheduler at
`GET /api/cron/maintenance` with header `Authorization: Bearer $CRON_SECRET` once a day.

---

## 2. Run it locally

```bash
cp .env.example .env              # then edit DATABASE_URL etc.
npm install
npm run db:migrate                # create tables, triggers and constraints
npm run dev                       # http://localhost:3000, go to /setup
```

**Demonstration data** (clearly labelled, with fake balances). Only on an empty database:

```bash
npm run db:seed:demo
# sign in as parent1 / parent2 / child14 / child16 / child18, password: demo-password
```

To start a **clean live household** instead, don't seed. Just visit `/setup`. To wipe a local database: `npm run db:reset` (refuses in production).

---

## 3. Everyday use

**Parents (you and your partner, both full admins)**

- **Dashboard → Quick record:** *Add Points* (bonus, agreed work or opening balance), *Record a spend* (from the marketplace or anything else) and *Record a job* (pays an existing job). This is the fastest path while the kids are view-only.
- **Inbox:** one place for submitted jobs, job proposals, purchase requests, cash-out requests, items to hand over, corrections awaiting the other parent, and review requests.
- **Jobs / Shop:** create, price, pause and archive jobs, recurring jobs, multi-milestone projects and marketplace items, including subscriptions and time-limited privileges.
- **Each child's page:** balance, full history, *Reverse as an error* on any transaction, other corrections, subscriptions (pause/cancel), savings goals (unlock), cash-outs, participation, password reset, audit trail, and *View as…* to see exactly what they see.
- **Economy:** charts, category breakdowns, most-claimed jobs, upcoming charges, CSV exports, ledger, audit log and reconciliation check.
- **Settings:** people, *Kids can make requests*, exchange rate, cash-out rules, budgets, grace period, correction policy, categories and the family charter.

**Kids**

- **Home:** balance (with AUD value, savings, holds and pending), jobs, goals, upcoming charges, recent activity.
- **Earn / Spend / Wallet / More:** job board, marketplace (shows how many more Points they need), full searchable history, cash-out, savings goals, subscriptions, receipts, the charter, review requests and pause/resume.

### View-only mode (the default)

*Settings → Kids can make requests* is **off** to start. Kids can see everything but can't claim, request, cash out or move savings; you record it all for them. Turn it on whenever you're ready. Nothing else changes, and approval rules still apply.

---

## 4. Accounts and recovery

- Passwords are hashed with **Argon2id**. Sessions are random tokens stored only as SHA-256 hashes, last 30 days, and are revoked on password change or account archive.
- Logins are **rate limited** (5 failures per username or 20 per IP per 15 minutes).
- **Kids don't need email.** A parent resets their password from the child's page. They get a temporary password and must choose a new one at next sign-in.
- **A parent who's locked out** can be reset by the other parent the same way.
- **Both parents locked out:** from a machine with the code and the database URL:
  ```bash
  DATABASE_URL="…" npm run admin:reset-password -- <username> <temporary-password>
  ```

---

## 5. Database, migrations and integrity

- Schema: `src/db/schema.ts`. Migrations: `drizzle/` (plain SQL; `0001_integrity.sql` adds the append-only triggers, non-negative balance trigger and CHECK constraints).
- Apply migrations: `npm run db:migrate` (safe to re-run).
- Changing the schema: edit `schema.ts`, run `npm run db:generate`, review the new SQL, commit it, then `npm run db:migrate`.
- **Reconcile** the ledger against displayed balances at any time: `npm run reconcile` (exits non-zero on mismatch). The Economy screen shows the same check.

## 6. Backup and restore

Your data is just the Postgres database.

- **Neon:** point-in-time restore is built in (7 days on the free tier). Use *Branches → Restore*.
- **Manual backup** (do this monthly, keep it somewhere safe):
  ```bash
  pg_dump --format=custom --no-owner "$DATABASE_URL" > family-economy-$(date +%F).dump
  ```
- **Restore** into an empty database:
  ```bash
  pg_restore --no-owner --dbname "$NEW_DATABASE_URL" family-economy-YYYY-MM-DD.dump
  ```
  Then set `DATABASE_URL` to the new database and redeploy. The append-only triggers are restored with the data.
- CSV exports (Economy → Export) are a human-readable copy but not a restorable backup.

## 7. Tests

Both suites run against a real PostgreSQL (financial guarantees live partly in the database).

```bash
# unit and financial tests (uses DATABASE_URL_TEST, default postgres://postgres:postgres@localhost:5432/family_economy_test)
npm test

# end-to-end (uses DATABASE_URL_E2E; builds must be current: npm run build first)
npx playwright install chromium   # once
npm run test:e2e
```

Covered: earning (including concurrent double-approval, recurring occurrences and projects), proposals and counter-offers, purchases (holds, concurrency, idempotent retries, refunds, limits, insufficient balance), cash-out (rate snapshot, concurrent double-payment), subscriptions (idempotent billing, grace, lapse, pause), savings earmarks, corrections, DB-level immutability and non-negative balances, view-only mode, permissions, CSV export and the cron secret.

---

## 8. Features (version one)

Household onboarding · two admin parents · three participant accounts (any number supported) · secure auth with parent recovery · individual wallets · immutable ledger · jobs, recurring jobs and multi-milestone projects · claim/submit/approve with photos · partial payment, send back and reject · auto-credit on approval · child-proposed jobs with counter-offers · marketplace with categories, limits, approvals and receipts · manual fulfilment tracking · time-limited privileges · recurring subscriptions with grace periods · cash-out requests with manual payout recording · savings goals with optional lock · parent dashboard and unified inbox · child dashboard · editable, versioned family charter with acknowledgements · participation status (active, paused, not participating) · in-app notifications · searchable history · reports and charts · audit trail · CSV export · installable PWA · view-only mode · parent quick-record tools · preview the child view · automated tests.

## 9. Known limitations

- No email or push notifications (in-app only).
- No real bank payments. Cash-outs are recorded manually after you pay.
- Privileges aren't enforced technically (no router or phone-carrier integration). The app records the agreement.
- Exchange-rate decreases after go-live are blocked outright rather than handled per batch of issued Points.
- Photos are stored in the database (downscaled on the phone to about 1600 px, max 3 MB). Fine for a family, but it grows the database over years.
- One household per deployment (the data model is multi-household and isolated; the setup flow creates exactly one).
- Future-enhancement modules from the brief (sibling transfers, savings matching, service contracts, calendar sync) are not built; the ledger and holds model supports adding them without rework.
- Offline: the app shows an offline notice. Balances and transactions always need a live connection by design, and no financial data is cached on the device.
