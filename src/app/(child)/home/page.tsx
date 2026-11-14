import Link from "next/link";
import { getDb } from "@/db";
import { requireViewer } from "@/server/auth";
import { listMyClaims } from "@/server/jobs";
import { upcomingCharges } from "@/server/marketplace";
import { activeEntitlements, goals, notifications, transactions, wallet } from "@/server/queries";
import { latestSignificantCharter } from "@/server/household";
import { charterAcknowledgement } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { formatDate } from "@/lib/time";
import { BalanceCard, QuickAction, TxRow, ViewOnlyNote } from "@/components/money-bits";
import { Empty, Notice, Points, Progress, Row, Rows, Section, Status } from "@/components/ui";
import { Icon } from "@/components/nav";

export default async function Home() {
  const v = await requireViewer();
  const db = getDb();
  const actor = { ...v.actor, memberId: v.subjectId, role: "CHILD" as const };
  const [w, txs, myGoals, claims, upcoming, ents, notes, charter] = await Promise.all([
    wallet(db, v.subjectId),
    transactions(db, v.subjectId, { limit: 5 }),
    goals(db, v.subjectId),
    listMyClaims(db, actor, ["CLAIMED", "IN_PROGRESS", "RETURNED", "SUBMITTED"]),
    upcomingCharges(db, v.subjectId, v.timezone, 31),
    activeEntitlements(db, v.subjectId),
    notifications(db, v.subjectId, 3),
    latestSignificantCharter(db, v.householdId),
  ]);
  let needsAck = false;
  if (charter && !v.previewing) {
    const [ack] = await db
      .select()
      .from(charterAcknowledgement)
      .where(and(eq(charterAcknowledgement.charterVersionId, charter.id), eq(charterAcknowledgement.memberId, v.subjectId)));
    needsAck = !ack;
  }
  const upcomingTotal = upcoming.reduce((s, u) => s + u.points, 0);
  const unread = notes.filter((n) => !n.readAt);

  return (
    <>
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-[1.5rem] font-semibold">Hi {v.subjectName}</h1>
        <Link href="/more/notifications" className="relative rounded-full p-2 text-muted hover:bg-surface" aria-label="Notifications">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
            <path d="M6 9a6 6 0 1 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9Zm4 11a2 2 0 0 0 4 0" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {unread.length > 0 && <span className="absolute top-1.5 right-1.5 h-2.5 w-2.5 rounded-full bg-hold" />}
        </Link>
      </div>

      {needsAck && (
        <Notice tone="warn">
          {charter && charter.version > 1 ? "The family charter has been updated." : "Welcome! Start by reading the family charter."}{" "}
          <Link href="/more/charter" className="font-semibold underline">Read and acknowledge it</Link>.
        </Notice>
      )}

      <BalanceCard w={w} rate={v.centsPerPoint} />

      {v.readOnly && !v.previewing ? (
        <div className="mt-4">
          <ViewOnlyNote />
        </div>
      ) : (
        <div className="mt-4 mb-6 grid grid-cols-4 gap-2">
          <QuickAction href="/earn" label="Find work" icon={<Icon name="earn" />} />
          <QuickAction href="/spend" label="Spend" icon={<Icon name="spend" />} />
          <QuickAction href="/wallet/goals" label="Save" icon={<Icon name="wallet" />} />
          <QuickAction href="/wallet/cash-out" label="Cash out" icon={<span className="font-display text-lg font-bold">$</span>} />
        </div>
      )}

      {unread.length > 0 && (
        <Section title="New for you" action={<Link href="/more/notifications" className="text-sm text-euc">All</Link>}>
          <Rows>
            {unread.map((n) => (
              <Row key={n.id} href={n.link ?? "/more/notifications"}>
                <div className="min-w-0">
                  <div className="font-medium">{n.title}</div>
                  {n.body && <div className="truncate text-sm text-muted">{n.body}</div>}
                </div>
              </Row>
            ))}
          </Rows>
        </Section>
      )}

      {claims.length > 0 && (
        <Section title="Your jobs">
          <Rows>
            {claims.map(({ claim, occ }) => (
              <Row key={claim.id} href={`/earn/claim/${claim.id}`}>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{occ.title}</div>
                  <Status value={claim.status} />
                </div>
                <Points value={occ.rewardPoints} />
              </Row>
            ))}
          </Rows>
        </Section>
      )}

      {myGoals.length > 0 && (
        <Section title="Saving for" action={<Link href="/wallet/goals" className="text-sm text-euc">Goals</Link>}>
          <Rows>
            {myGoals.map((g) => (
              <Row key={g.id} href="/wallet/goals">
                <span className="text-2xl" aria-hidden>{g.icon}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex justify-between gap-2">
                    <span className="truncate font-medium">{g.title}</span>
                    <span className="text-sm text-muted tabular-nums">
                      {g.saved.toLocaleString("en-AU")} / {g.targetPoints.toLocaleString("en-AU")}
                    </span>
                  </div>
                  <div className="mt-1.5">
                    <Progress pct={g.pct} />
                  </div>
                </div>
              </Row>
            ))}
          </Rows>
        </Section>
      )}

      {(upcoming.length > 0 || ents.length > 0) && (
        <Section title="Coming up" action={<Link href="/more/subscriptions" className="text-sm text-euc">Subscriptions</Link>}>
          <Rows>
            {upcoming.slice(0, 5).map((u, i) => (
              <Row key={i}>
                <div className="flex-1">
                  <div className="font-medium">{u.name}</div>
                  <div className="text-xs text-muted">{u.status === "UNPAID" ? "Unpaid" : `Due ${formatDate(u.dueAt, v.timezone)}`}</div>
                </div>
                <Points value={u.points} />
              </Row>
            ))}
            {upcoming.length > 0 && (
              <Row className="bg-paper/60">
                <span className="flex-1 text-sm text-muted">Projected next 31 days</span>
                <Points value={upcomingTotal} className="font-semibold" />
              </Row>
            )}
            {ents.map((e) => (
              <Row key={e.id}>
                <span className="flex-1 font-medium">{e.name}</span>
                <span className="text-sm text-muted">Active until {formatDate(e.endsAt, v.timezone)}</span>
              </Row>
            ))}
          </Rows>
        </Section>
      )}

      <Section title="Recent activity" action={<Link href="/wallet" className="text-sm text-euc">History</Link>}>
        {txs.length ? (
          <Rows>
            {txs.map((e) => (
              <TxRow key={e.id} e={e} rate={v.centsPerPoint} tz={v.timezone} />
            ))}
          </Rows>
        ) : (
          <Empty>No transactions yet. Your first earnings will show up here.</Empty>
        )}
      </Section>
    </>
  );
}
