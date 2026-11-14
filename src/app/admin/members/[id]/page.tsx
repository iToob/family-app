import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { householdMember, user } from "@/db/schema";
import { requireParentSession } from "@/server/auth";
import {
  auditTrail,
  completedJobs,
  goals,
  marketplace,
  memberCashOuts,
  memberSubscriptions,
  openOccurrences,
  participationHistory,
  transactions,
  wallet,
} from "@/server/queries";
import {
  correctionAction,
  goalLockAction,
  participationAction,
  previewAction,
  resetPasswordAction,
  subscriptionAction,
  updateMemberAction,
} from "../../../actions";
import { ActionForm, Field, Submit } from "@/components/forms";
import { BalanceCard } from "@/components/money-bits";
import { QuickRecord } from "@/components/quick-record";
import { Avatar, LEDGER_LABEL, PageHeader, Panel, Points, Progress, Row, Rows, Section, Status } from "@/components/ui";
import { formatAud, pointsToCents } from "@/lib/money";
import { formatDate } from "@/lib/time";

export default async function MemberPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ q?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const s = await requireParentSession();
  const db = getDb();
  const [m] = await db
    .select({ m: householdMember, username: user.username })
    .from(householdMember)
    .innerJoin(user, eq(householdMember.userId, user.id))
    .where(and(eq(householdMember.id, id), eq(householdMember.householdId, s.actor.householdId)));
  if (!m) notFound();
  const member = m.m;
  const tz = s.timezone;
  const rate = s.centsPerPoint;

  if (member.role === "PARENT") {
    return (
      <>
        <PageHeader title={member.displayName} back="/admin/settings" subtitle={`Parent, username ${m.username}`} />
        <MemberAdmin id={id} name={member.displayName} color={member.avatarColor} self={id === s.actor.memberId} />
      </>
    );
  }

  const [w, txs, gs, subs, cashouts, jobs, occs, items, history, audit] = await Promise.all([
    wallet(db, id),
    transactions(db, id, { q: sp.q, limit: 300 }),
    goals(db, id),
    memberSubscriptions(db, id),
    memberCashOuts(db, id),
    completedJobs(db, id, 20),
    openOccurrences(db, s.actor.householdId),
    marketplace(db, s.actor.householdId),
    participationHistory(db, s.actor.householdId, id),
    auditTrail(db, s.actor.householdId, 40, id),
  ]);
  const reversed = new Set(txs.map((t) => t.reversesEntryId).filter(Boolean));

  return (
    <>
      <PageHeader
        title={member.displayName}
        back="/admin"
        subtitle={<>Username {m.username} <Status value={member.participationStatus} /></>}
        action={
          <form action={previewAction}>
            <button name="memberId" value={id} className="btn btn-secondary btn-small">View as {member.displayName}</button>
          </form>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <div>
          <BalanceCard w={w} rate={rate} name={member.displayName} />
          <dl className="mt-3 grid grid-cols-3 gap-2 text-center text-sm">
            {[["Earned", w.lifetimeEarned], ["Spent", w.lifetimeSpent], ["Cashed out", w.lifetimeConverted]].map(([k, n]) => (
              <div key={k as string} className="panel px-2 py-2">
                <dt className="text-xs text-muted">{k} all-time</dt>
                <dd className="font-semibold tabular-nums">{(n as number).toLocaleString("en-AU")}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div>
          <QuickRecord kids={[member]} occurrences={occs} items={items} rate={rate} memberId={id} />
        </div>
      </div>

      <Section title="Transactions" className="mt-6">
        <form className="mb-3 flex gap-2" role="search">
          <input name="q" defaultValue={sp.q} placeholder="Search" className="input" aria-label="Search transactions" />
          <button className="btn btn-secondary">Search</button>
        </form>
        <Rows>
          {txs.length === 0 && <Row><span className="text-muted">No transactions.</span></Row>}
          {txs.map((e) => (
            <div key={e.id} className="px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{e.description}</div>
                  <div className="text-xs text-muted">{LEDGER_LABEL[e.type]}, {formatDate(e.occurredAt, tz, true)}</div>
                </div>
                <div className="text-right">
                  <Points value={e.points} signed tone="auto" size={14} className="font-semibold" />
                  <div className="text-xs text-muted">{formatAud(e.audCents ?? pointsToCents(Math.abs(e.points), e.centsPerPoint ?? rate))}</div>
                </div>
              </div>
              {!reversed.has(e.id) && !e.reversesEntryId && e.type !== "CASH_CONVERSION" && (
                <details className="mt-1">
                  <summary className="text-xs text-muted hover:text-ink">Reverse as an error…</summary>
                  <ActionForm action={correctionAction} className="mt-2 flex gap-2" confirm="Post a visible correction reversing this transaction?">
                    <input type="hidden" name="memberId" value={id} />
                    <input type="hidden" name="reversesEntryId" value={e.id} />
                    <input name="reason" className="input" required placeholder="What was the error?" />
                    <Submit small variant="danger">Reverse</Submit>
                  </ActionForm>
                </details>
              )}
            </div>
          ))}
        </Rows>
        <details className="panel mt-3 px-4 py-3">
          <summary className="font-medium">Other correction…</summary>
          <p className="mt-2 text-sm text-muted">Only for genuine errors. Corrections are visible to {member.displayName} with your reason, and nothing is ever deleted.</p>
          <ActionForm action={correctionAction} className="mt-3 grid gap-2 sm:grid-cols-[8rem_1fr_auto]" resetOnSuccess>
            <input type="hidden" name="memberId" value={id} />
            <input name="points" className="input" inputMode="numeric" placeholder="+/- Points" required aria-label="Points (negative to deduct)" />
            <input name="reason" className="input" required placeholder="Reason" />
            <Submit small>Post correction</Submit>
          </ActionForm>
        </details>
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Subscriptions">
          <Rows>
            {subs.length === 0 && <Row><span className="text-muted">None.</span></Row>}
            {subs.map((x) => (
              <div key={x.id} className="px-4 py-3">
                <div className="flex justify-between gap-2">
                  <span className="font-medium">{x.name}</span>
                  <Status value={x.status} />
                </div>
                <div className="text-xs text-muted">
                  {x.pricePoints.toLocaleString("en-AU")} Points {x.frequency.toLowerCase()}{x.status !== "CANCELLED" ? `, next ${formatDate(x.nextDueAt, tz)}` : ""}
                </div>
                {x.status !== "CANCELLED" && (
                  <div className="mt-2 flex gap-2">
                    {x.status === "PAUSED" ? (
                      <SubBtn id={x.id} action="RESUME" label="Resume" />
                    ) : (
                      <SubBtn id={x.id} action="PAUSE" label="Pause" />
                    )}
                    <SubBtn id={x.id} action="CANCEL" label="Cancel" danger />
                  </div>
                )}
              </div>
            ))}
          </Rows>
        </Section>

        <Section title="Savings goals">
          <Rows>
            {gs.length === 0 && <Row><span className="text-muted">None.</span></Row>}
            {gs.map((g) => (
              <div key={g.id} className="px-4 py-3">
                <div className="flex justify-between text-sm">
                  <span className="font-medium">{g.icon} {g.title}</span>
                  <span className="tabular-nums text-muted">{g.saved.toLocaleString("en-AU")} / {g.targetPoints.toLocaleString("en-AU")}</span>
                </div>
                <div className="mt-1.5"><Progress pct={g.pct} /></div>
                {g.locked && (
                  <ActionForm action={goalLockAction} className="mt-2">
                    <input type="hidden" name="goalId" value={g.id} />
                    <input type="hidden" name="locked" value="no" />
                    <Submit small variant="secondary">Unlock</Submit>
                  </ActionForm>
                )}
              </div>
            ))}
          </Rows>
        </Section>

        <Section title="Cash-outs">
          <Rows>
            {cashouts.length === 0 && <Row><span className="text-muted">None.</span></Row>}
            {cashouts.map((c) => (
              <Row key={c.id}>
                <div className="flex-1">
                  <div className="font-medium">{formatAud(c.audCents)}</div>
                  <div className="text-xs text-muted">{formatDate(c.requestedAt, tz)}{c.paidAt ? `, paid ${formatDate(c.paidAt, tz)} (${c.method}${c.reference ? `, ${c.reference}` : ""})` : ""}</div>
                </div>
                <Status value={c.status} />
              </Row>
            ))}
          </Rows>
        </Section>

        <Section title="Recently completed jobs">
          <Rows>
            {jobs.length === 0 && <Row><span className="text-muted">None yet.</span></Row>}
            {jobs.map(({ claim, occ }) => (
              <Row key={claim.id} href={`/admin/jobs/claim/${claim.id}`}>
                <span className="flex-1 truncate">{occ.title}</span>
                <span className="text-xs text-muted">{formatDate(claim.updatedAt, tz)}</span>
              </Row>
            ))}
          </Rows>
        </Section>
      </div>

      <Section title="Participation">
        <Panel className="px-4 py-4">
          <ActionForm action={participationAction} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="memberId" value={id} />
            <span className="mr-2">Set status:</span>
            <Submit small variant="secondary" name="status" value="ACTIVE">Active</Submit>
            <Submit small variant="secondary" name="status" value="PAUSED">Paused</Submit>
            <Submit small variant="secondary" name="status" value="NOT_PARTICIPATING">Not participating</Submit>
          </ActionForm>
          {history.length > 0 && (
            <ul className="mt-3 space-y-1 text-sm text-muted">
              {history.map((h) => {
                const d = h.details as { from?: string; to?: string } | null;
                return <li key={h.id}>{formatDate(h.createdAt, tz)}: {d?.from?.toLowerCase().replace("_", " ")} to {d?.to?.toLowerCase().replace("_", " ")}</li>;
              })}
            </ul>
          )}
        </Panel>
      </Section>

      <MemberAdmin id={id} name={member.displayName} color={member.avatarColor} self={false} />

      <Section title="Audit trail">
        <ul className="panel rows text-sm">
          {audit.map(({ log, actorName }) => (
            <li key={log.id} className="flex justify-between gap-3 px-4 py-2">
              <span><span className="font-medium">{actorName ?? "System"}</span> {log.action.replaceAll(".", " ").replaceAll("_", " ")}</span>
              <span className="shrink-0 text-muted">{formatDate(log.createdAt, tz, true)}</span>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}

function SubBtn({ id, action, label, danger }: { id: string; action: string; label: string; danger?: boolean }) {
  return (
    <ActionForm action={subscriptionAction} confirm={action === "CANCEL" ? "Cancel this subscription? Any already-paid period continues to its end." : undefined}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="action" value={action} />
      <Submit small variant={danger ? "danger" : "secondary"}>{label}</Submit>
    </ActionForm>
  );
}

function MemberAdmin({ id, name, color, self }: { id: string; name: string; color: string; self: boolean }) {
  return (
    <Section title="Account">
      <Panel className="space-y-5 px-4 py-4">
        <ActionForm action={updateMemberAction} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="memberId" value={id} />
          <Avatar name={name} color={color} size={40} />
          <Field label="Display name" className="flex-1"><input name="displayName" className="input" defaultValue={name} /></Field>
          <Field label="Colour"><input type="color" name="avatarColor" defaultValue={color} className="h-11 w-14 rounded-lg border border-line" /></Field>
          <Submit small variant="secondary">Save</Submit>
        </ActionForm>
        <ActionForm action={resetPasswordAction} className="flex flex-wrap items-end gap-2" resetOnSuccess>
          <input type="hidden" name="memberId" value={id} />
          <Field label={self ? "Set a new password" : "Reset password (temporary)"} hint={self ? undefined : `${name} will choose a new one at next sign-in.`} className="flex-1">
            <input name="password" className="input" minLength={8} required autoComplete="off" />
          </Field>
          <Submit small variant="secondary">Set password</Submit>
        </ActionForm>
        {!self && (
          <ActionForm action={updateMemberAction} confirm={`Archive ${name}'s account? They won't be able to sign in. All history is kept.`}>
            <input type="hidden" name="memberId" value={id} />
            <input type="hidden" name="archived" value="yes" />
            <Submit small variant="danger">Archive account</Submit>
          </ActionForm>
        )}
      </Panel>
    </Section>
  );
}
