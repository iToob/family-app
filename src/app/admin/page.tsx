import Link from "next/link";
import { getDb } from "@/db";
import { requireParentSession } from "@/server/auth";
import { getSettings } from "@/server/core";
import { runMaintenance } from "@/server/household";
import { upcomingCharges } from "@/server/marketplace";
import { childrenSummary, economyOverview, inboxCount, marketplace, openOccurrences } from "@/server/queries";
import { previewAction } from "../actions";
import { QuickRecord } from "@/components/quick-record";
import { Aud, Avatar, Notice, PageHeader, Points, Section, Stat, Status } from "@/components/ui";
import { formatAud } from "@/lib/money";

export default async function Dashboard() {
  const s = await requireParentSession();
  const db = getDb();
  const hid = s.actor.householdId;
  const settings = await getSettings(db, hid);
  // Opportunistic, idempotent housekeeping in case the scheduled job hasn't run.
  if (!settings.lastMaintenanceAt || Date.now() - settings.lastMaintenanceAt.getTime() > 10 * 60_000) {
    await runMaintenance(db, hid).catch((e) => console.error("maintenance", e));
  }
  const [o, kids, inbox, occs, items] = await Promise.all([
    economyOverview(db, hid, s.timezone),
    childrenSummary(db, hid),
    inboxCount(db, hid),
    openOccurrences(db, hid),
    marketplace(db, hid),
  ]);
  const upcomingTotal = (await Promise.all(kids.map((k) => upcomingCharges(db, k.member.id, s.timezone, 7))))
    .flat()
    .reduce((a, u) => a + u.points, 0);
  const rate = o.centsPerPoint;
  const overBudget = o.weeklyBudget && o.earned_week + o.committed > o.weeklyBudget;

  return (
    <>
      <PageHeader title={`Hi ${s.actor.displayName}`} subtitle={s.householdName} />

      {kids.length === 0 && (
        <Notice>
          Welcome! <Link href="/admin/setup" className="font-semibold underline">Finish setting up</Link>: add the other parent, the kids and any opening balances.
        </Notice>
      )}
      {inbox > 0 && (
        <Link href="/admin/approvals" className="mb-4 flex items-center justify-between rounded-xl bg-hold-100 px-4 py-3 text-hold">
          <span className="font-semibold">{inbox} {inbox === 1 ? "item needs" : "items need"} your attention</span>
          <span aria-hidden>›</span>
        </Link>
      )}

      <Section title="Quick record">
        <QuickRecord
          kids={kids.map((k) => k.member)}
          occurrences={occs}
          items={items}
          rate={rate}
        />
      </Section>

      <Section title="The kids">
        <div className="panel overflow-x-auto">
          <table className="w-full min-w-[520px] text-left">
            <thead className="text-sm text-muted">
              <tr className="border-b border-line">
                <th className="px-4 py-2.5 font-medium">Name</th>
                <th className="px-3 py-2.5 text-right font-medium">Available</th>
                <th className="px-3 py-2.5 text-right font-medium">Pending</th>
                <th className="px-3 py-2.5 text-right font-medium">Held</th>
                <th className="px-3 py-2.5 text-right font-medium">Saved</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {kids.map(({ member: m, wallet: w }) => (
                <tr key={m.id} className="border-b border-line last:border-0 hover:bg-euc-100/40">
                  <td className="px-4 py-3">
                    <Link href={`/admin/members/${m.id}`} className="flex items-center gap-2.5 font-medium">
                      <Avatar name={m.displayName} color={m.avatarColor} size={28} />
                      {m.displayName}
                    </Link>
                  </td>
                  <td className="px-3 py-3 text-right">
                    <Points value={w.available} className="font-semibold" size={14} />
                    <div className="text-xs text-muted"><Aud points={w.available} rate={rate} /></div>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">{w.pendingEarnings.toLocaleString("en-AU")}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{w.held.toLocaleString("en-AU")}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{w.saved.toLocaleString("en-AU")}</td>
                  <td className="px-4 py-3"><Status value={m.participationStatus} /></td>
                </tr>
              ))}
              {kids.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-muted">No children added yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Economy health">
        {overBudget && (
          <Notice tone="warn">
            This week's earnings plus committed rewards ({(o.earned_week + o.committed).toLocaleString("en-AU")}) are above your weekly target of {o.weeklyBudget!.toLocaleString("en-AU")} Points. Existing commitments are unaffected.
          </Notice>
        )}
        <div className="panel grid grid-cols-2 divide-line md:grid-cols-4 [&>*]:border-line [&>*:nth-child(n+3)]:border-t md:[&>*:nth-child(n+3)]:border-t-0 md:[&>*:nth-child(n+5)]:border-t">
          <Stat label="Points outstanding" hint={formatAud(o.outstanding * rate)}>{o.outstanding.toLocaleString("en-AU")}</Stat>
          <Stat label="Earned this week">{o.earned_week.toLocaleString("en-AU")}</Stat>
          <Stat label="Spent this week">{o.spent_week.toLocaleString("en-AU")}</Stat>
          <Stat label="Cash paid this month">{formatAud(o.payouts_month_cents)}</Stat>
          <Stat label="Jobs awaiting approval">{o.jobs_awaiting}</Stat>
          <Stat label="Payout requests">{o.payout_requests}</Stat>
          <Stat label="Awaiting delivery">{o.awaiting_fulfilment}</Stat>
          <Stat label="Charges next 7 days">{upcomingTotal.toLocaleString("en-AU")}</Stat>
        </div>
        <p className="mt-2 px-1 text-xs text-muted">
          Outstanding Points are a guide to what you could be asked to honour, not formal accounting. {o.issued.toLocaleString("en-AU")} Points issued all-time; {o.committed.toLocaleString("en-AU")} committed to claimed jobs.
          {o.weeklyBudget ? ` Weekly target: ${o.weeklyBudget.toLocaleString("en-AU")}.` : ""}
        </p>
      </Section>

      {kids.length > 0 && (
        <Section title="See what the kids see">
          <form action={previewAction} className="flex flex-wrap gap-2">
            {kids.map(({ member: m }) => (
              <button key={m.id} name="memberId" value={m.id} className="btn btn-secondary btn-small">
                View as {m.displayName}
              </button>
            ))}
          </form>
        </Section>
      )}
    </>
  );
}
