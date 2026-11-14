import Link from "next/link";
import { getDb } from "@/db";
import { requireParentSession } from "@/server/auth";
import { getSettings } from "@/server/core";
import { byCategory, childrenSummary, economyOverview, flowSeries, reconcile, topJobs } from "@/server/queries";
import { upcomingCharges } from "@/server/marketplace";
import { runMaintenanceAction } from "../../actions";
import { ActionForm, Submit } from "@/components/forms";
import { BarChart, HBars, PageHeader, Panel, Points, Row, Rows, Section, Stat } from "@/components/ui";
import { formatAud } from "@/lib/money";
import { formatDate } from "@/lib/time";

const EXPORTS = [
  ["ledger", "Transaction ledger"],
  ["earnings", "Earnings"],
  ["purchases", "Purchases"],
  ["payouts", "Cash payouts"],
  ["balances", "Participant balances"],
  ["jobs", "Job history"],
] as const;

export default async function Economy({ searchParams }: { searchParams: Promise<{ member?: string; period?: string }> }) {
  const sp = await searchParams;
  const s = await requireParentSession();
  const db = getDb();
  const hid = s.actor.householdId;
  const period = sp.period === "month" ? "month" : "week";
  const kids = await childrenSummary(db, hid);
  const memberId = kids.some((k) => k.member.id === sp.member) ? sp.member : undefined;
  const [o, series, earnedCats, spentCats, top, rec, st] = await Promise.all([
    economyOverview(db, hid, s.timezone),
    flowSeries(db, hid, s.timezone, period, period === "week" ? 12 : 12, memberId),
    byCategory(db, hid, "earned", memberId),
    byCategory(db, hid, "spent", memberId),
    topJobs(db, hid),
    reconcile(db, hid),
    getSettings(db, hid),
  ]);
  const upcoming = (await Promise.all(kids.map(async (k) => (await upcomingCharges(db, k.member.id, s.timezone, 31)).map((u) => ({ ...u, who: k.member.displayName }))))).flat().sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
  const rate = o.centsPerPoint;
  const chip = (href: string, label: string, active: boolean) => (
    <Link key={href} href={href} className={`rounded-full px-3 py-1.5 text-sm ${active ? "bg-euc text-white" : "bg-surface ring-1 ring-line"}`}>{label}</Link>
  );
  const q = (m?: string, p?: string) => `/admin/economy?${new URLSearchParams({ ...(m ? { member: m } : {}), ...(p ? { period: p } : {}) })}`;

  return (
    <>
      <PageHeader title="Economy" subtitle="How Points are flowing. For your family's planning, not accounting advice." />

      <div className="panel mb-6 grid grid-cols-2 md:grid-cols-4">
        <Stat label="Issued all-time">{o.issued.toLocaleString("en-AU")}</Stat>
        <Stat label="Outstanding" hint={formatAud(o.outstanding * rate)}>{o.outstanding.toLocaleString("en-AU")}</Stat>
        <Stat label="Earned this month">{o.earned_month.toLocaleString("en-AU")}</Stat>
        <Stat label="Cash paid this month">{formatAud(o.payouts_month_cents)}</Stat>
      </div>

      <div className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4">
        {chip(q(undefined, period), "Whole family", !memberId)}
        {kids.map((k) => chip(q(k.member.id, period), k.member.displayName, memberId === k.member.id))}
      </div>
      <div className="mb-4 flex gap-2">
        {chip(q(memberId, "week"), "Weekly", period === "week")}
        {chip(q(memberId, "month"), "Monthly", period === "month")}
      </div>

      <Section title="Points earned, spent and cashed out">
        <Panel className="px-4 py-4">
          <BarChart
            data={series}
            series={[
              { key: "earned", label: "Earned", color: "#17845a" },
              { key: "spent", label: "Spent", color: "#b8892b" },
              { key: "cashed", label: "Cashed out", color: "#5b6b66" },
            ]}
          />
        </Panel>
      </Section>

      <div className="grid gap-6 md:grid-cols-2">
        <Section title="Earnings by category"><Panel className="px-4 py-4"><HBars data={earnedCats.map((c) => ({ label: c.category, value: c.points }))} color="#17845a" /></Panel></Section>
        <Section title="Spending by category"><Panel className="px-4 py-4"><HBars data={spentCats.map((c) => ({ label: c.category, value: c.points }))} color="#b8892b" /></Panel></Section>
        <Section title="Most claimed jobs">
          <Rows>
            {top.length === 0 && <Row><span className="text-muted">No jobs claimed yet.</span></Row>}
            {top.map((t) => (
              <Row key={t.title}>
                <span className="flex-1 truncate">{t.title}</span>
                <span className="text-sm text-muted">{t.count}×</span>
                <Points value={t.points} size={13} />
              </Row>
            ))}
          </Rows>
        </Section>
        <Section title="Upcoming recurring charges" action={<Link href="/admin/economy/subscriptions" className="text-sm text-euc">All subscriptions</Link>}>
          <Rows>
            {upcoming.length === 0 && <Row><span className="text-muted">None in the next month.</span></Row>}
            {upcoming.slice(0, 8).map((u, i) => (
              <Row key={i}>
                <span className="flex-1 truncate">{u.who}: {u.name}</span>
                <span className="text-xs text-muted">{formatDate(u.dueAt, s.timezone)}</span>
                <Points value={u.points} size={13} />
              </Row>
            ))}
          </Rows>
        </Section>
      </div>

      <Section title="Balances by person">
        <Rows>
          {kids.map(({ member, wallet: w }) => (
            <Row key={member.id} href={`/admin/members/${member.id}`}>
              <span className="flex-1 font-medium">{member.displayName}</span>
              <span className="text-sm text-muted">saved {w.saved.toLocaleString("en-AU")}</span>
              <Points value={w.ledger} className="font-semibold" />
            </Row>
          ))}
        </Rows>
      </Section>

      <div className="grid gap-6 md:grid-cols-2">
        <Section title="Export (CSV)">
          <Rows>
            {EXPORTS.map(([k, label]) => (
              <Row key={k}>
                <span className="flex-1">{label}</span>
                <a href={`/api/export/${k}`} className="btn btn-secondary btn-small" download>Download</a>
              </Row>
            ))}
          </Rows>
        </Section>
        <Section title="System">
          <Panel className="space-y-3 px-4 py-4 text-sm">
            <p>
              Ledger check:{" "}
              {rec.ok ? (
                <span className="font-semibold text-credit">reconciled ({rec.ledgerTotal.toLocaleString("en-AU")} Points)</span>
              ) : (
                <span className="font-semibold text-danger">mismatch, ledger {rec.ledgerTotal} vs balances {rec.memberTotal}</span>
              )}
            </p>
            <p className="text-muted">Recurring jobs and subscription billing run daily. Last run: {st.lastMaintenanceAt ? formatDate(st.lastMaintenanceAt, s.timezone, true) : "never"}.</p>
            <ActionForm action={runMaintenanceAction}>
              <Submit small variant="secondary">Process due subscriptions now</Submit>
            </ActionForm>
            <div className="flex gap-4">
              <Link href="/admin/economy/ledger" className="text-euc underline">Full ledger</Link>
              <Link href="/admin/economy/audit" className="text-euc underline">Audit log</Link>
            </div>
          </Panel>
        </Section>
      </div>
    </>
  );
}
