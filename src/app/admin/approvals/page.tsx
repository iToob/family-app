import Link from "next/link";
import { getDb } from "@/db";
import { requireParentSession } from "@/server/auth";
import { getSettings } from "@/server/core";
import { approvalsInbox } from "@/server/queries";
import {
  approveCashOutAction,
  approvePurchaseAction,
  bulkApproveAction,
  decideCorrectionAction,
  fulfilPurchaseAction,
  payCashOutAction,
  rejectCashOutAction,
  rejectPurchaseAction,
  resolveDisputeAction,
  respondProposalAction,
  reviewJobAction as reviewAction,
} from "../../actions";
import { ActionForm, Field, Submit } from "@/components/forms";
import { Avatar, Empty, PageHeader, Points, Section } from "@/components/ui";
import { formatAud } from "@/lib/money";
import { formatDate } from "@/lib/time";

function Card({ who, color, title, meta, right, children }: { who: string; color: string; title: React.ReactNode; meta?: React.ReactNode; right?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <li className="panel px-4 py-4">
      <div className="flex items-start gap-3">
        <Avatar name={who} color={color} size={30} />
        <div className="min-w-0 flex-1">
          <div className="font-medium">{title}</div>
          {meta && <div className="text-sm text-muted">{meta}</div>}
        </div>
        {right}
      </div>
      {children && <div className="mt-3">{children}</div>}
    </li>
  );
}

function Decline({ action, id, label = "Decline", field = "reason", placeholder = "Reason (shown to your child)" }: { action: Parameters<typeof ActionForm>[0]["action"]; id: string; label?: string; field?: string; placeholder?: string }) {
  return (
    <details className="mt-2">
      <summary className="text-sm font-medium text-danger">{label}…</summary>
      <ActionForm action={action} className="mt-2 flex gap-2">
        <input type="hidden" name="id" value={id} />
        <input name={field} className="input" required placeholder={placeholder} />
        <Submit small variant="danger">{label}</Submit>
      </ActionForm>
    </details>
  );
}

export default async function Approvals() {
  const s = await requireParentSession();
  const db = getDb();
  const [i, st] = await Promise.all([approvalsInbox(db, s.actor.householdId), getSettings(db, s.actor.householdId)]);
  const total = i.jobs.length + i.proposals.length + i.purchases.length + i.fulfilment.length + i.cashOuts.length + i.adjustments.length + i.disputes.length;
  const tz = s.timezone;

  return (
    <>
      <PageHeader title="Inbox" subtitle={total ? `${total} waiting on you` : undefined} />
      {total === 0 && <Empty>All clear. Nothing needs a decision.</Empty>}

      {i.jobs.length > 0 && (
        <Section
          title="Completed jobs"
          action={
            i.jobs.length > 1 ? (
              <ActionForm action={bulkApproveAction} confirm={`Approve and pay all ${i.jobs.length} jobs at full reward?`}>
                {i.jobs.map((j) => <input key={j.claim.id} type="hidden" name="claimId" value={j.claim.id} />)}
                <Submit small variant="secondary">Approve all ({i.jobs.length})</Submit>
              </ActionForm>
            ) : undefined
          }
        >
          <ul className="space-y-3">
            {i.jobs.map(({ claim, occ, member }) => (
              <Card
                key={claim.id}
                who={member.displayName}
                color={member.avatarColor}
                title={<Link href={`/admin/jobs/claim/${claim.id}`} className="hover:underline">{occ.title}</Link>}
                meta={`${member.displayName}, submitted ${formatDate(claim.updatedAt, tz, true)}`}
                right={<Points value={occ.rewardPoints} className="font-semibold" />}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <ActionForm action={reviewAction}>
                    <input type="hidden" name="claimId" value={claim.id} />
                    <input type="hidden" name="decision" value="APPROVED" />
                    <Submit small>Approve and pay</Submit>
                  </ActionForm>
                  <Link href={`/admin/jobs/claim/${claim.id}`} className="btn btn-secondary btn-small">Review details</Link>
                </div>
              </Card>
            ))}
          </ul>
        </Section>
      )}

      {i.cashOuts.length > 0 && (
        <Section title="Cash-out requests">
          <ul className="space-y-3">
            {i.cashOuts.map(({ r, member }) => (
              <Card
                key={r.id}
                who={member.displayName}
                color={member.avatarColor}
                title={`${formatAud(r.audCents)} for ${member.displayName}`}
                meta={`${r.points.toLocaleString("en-AU")} Points at ${r.centsPerPoint}c each. Prefers ${r.preferredMethod ?? "any method"}. ${r.status === "APPROVED" ? "Approved, awaiting payment." : ""}`}
              >
                <ActionForm action={payCashOutAction} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]" confirm={`Confirm you've paid ${formatAud(r.audCents)}? The Points will be deducted.`}>
                  <input type="hidden" name="id" value={r.id} />
                  <select name="method" className="input" defaultValue={r.preferredMethod ?? st.cashOutMethods[0]} aria-label="Payment method">
                    {st.cashOutMethods.map((m) => <option key={m}>{m}</option>)}
                  </select>
                  <input name="reference" className="input" placeholder="Reference (optional)" />
                  <Submit small>I've paid it</Submit>
                </ActionForm>
                <div className="mt-2 flex items-center gap-4">
                  {r.status === "REQUESTED" && (
                    <ActionForm action={approveCashOutAction}>
                      <input type="hidden" name="id" value={r.id} />
                      <Submit small variant="secondary">Approve, pay later</Submit>
                    </ActionForm>
                  )}
                  <Decline action={rejectCashOutAction} id={r.id} />
                </div>
              </Card>
            ))}
          </ul>
        </Section>
      )}

      {i.purchases.length > 0 && (
        <Section title="Purchase requests">
          <ul className="space-y-3">
            {i.purchases.map(({ p, member }) => (
              <Card key={p.id} who={member.displayName} color={member.avatarColor} title={p.itemName} meta={`${member.displayName}${p.note ? `: "${p.note}"` : ""}`} right={<Points value={p.pricePoints} className="font-semibold" />}>
                <ActionForm action={approvePurchaseAction}>
                  <input type="hidden" name="id" value={p.id} />
                  <Submit small>Approve</Submit>
                </ActionForm>
                <Decline action={rejectPurchaseAction} id={p.id} />
              </Card>
            ))}
          </ul>
        </Section>
      )}

      {i.proposals.length > 0 && (
        <Section title="Job proposals">
          <ul className="space-y-3">
            {i.proposals.map(({ p, member }) => (
              <Card key={p.id} who={member.displayName} color={member.avatarColor} title={p.title} meta={`Proposed by ${member.displayName}`} right={<Points value={p.proposedPoints} className="font-semibold" />}>
                <dl className="mb-3 space-y-1 text-sm">
                  <div><dt className="inline font-medium">What: </dt><dd className="inline">{p.whatToDo}</dd></div>
                  <div><dt className="inline font-medium">Who benefits: </dt><dd className="inline">{p.beneficiaries}</dd></div>
                  <div><dt className="inline font-medium">Why: </dt><dd className="inline">{p.valueReason}</dd></div>
                  {p.estimatedMinutes && <div><dt className="inline font-medium">Time: </dt><dd className="inline">{p.estimatedMinutes} min</dd></div>}
                  {p.materials && <div><dt className="inline font-medium">Materials: </dt><dd className="inline">{p.materials}</dd></div>}
                  {p.costs && <div><dt className="inline font-medium">Costs: </dt><dd className="inline">{p.costs}</dd></div>}
                </dl>
                <div className="flex flex-wrap gap-2">
                  <ActionForm action={respondProposalAction}>
                    <input type="hidden" name="id" value={p.id} />
                    <input type="hidden" name="action" value="APPROVE" />
                    <Submit small>Approve at {p.proposedPoints.toLocaleString("en-AU")}</Submit>
                  </ActionForm>
                </div>
                <details className="mt-2">
                  <summary className="text-sm font-medium text-euc">Counter-offer, ask for info or decline…</summary>
                  <ActionForm action={respondProposalAction} className="mt-2 space-y-2">
                    <input type="hidden" name="id" value={p.id} />
                    <Field label="Counter-offer Points (for a counter-offer)"><input name="points" className="input w-32" inputMode="numeric" /></Field>
                    <Field label="Message"><input name="message" className="input" /></Field>
                    <div className="flex flex-wrap gap-2">
                      <Submit small name="action" value="COUNTER">Send counter-offer</Submit>
                      <Submit small variant="secondary" name="action" value="INFO">Ask for info</Submit>
                      <Submit small variant="danger" name="action" value="DECLINE">Decline</Submit>
                    </div>
                  </ActionForm>
                </details>
              </Card>
            ))}
          </ul>
        </Section>
      )}

      {i.fulfilment.length > 0 && (
        <Section title="To hand over">
          <ul className="space-y-3">
            {i.fulfilment.map(({ p, member }) => (
              <Card key={p.id} who={member.displayName} color={member.avatarColor} title={p.itemName} meta={`Paid ${formatDate(p.decidedAt, tz)}. Receipt #${p.receiptNumber}`}>
                <ActionForm action={fulfilPurchaseAction}>
                  <input type="hidden" name="id" value={p.id} />
                  <Submit small>Mark as delivered</Submit>
                </ActionForm>
              </Card>
            ))}
          </ul>
        </Section>
      )}

      {i.adjustments.length > 0 && (
        <Section title="Corrections to review">
          <ul className="space-y-3">
            {i.adjustments.map(({ a, member }) => (
              <Card key={a.id} who={member.displayName} color={member.avatarColor} title={`${a.points > 0 ? "+" : ""}${a.points.toLocaleString("en-AU")} Points for ${member.displayName}`} meta={a.reason}>
                {a.requestedById === s.actor.memberId ? (
                  <p className="text-sm text-muted">Waiting for the other parent.</p>
                ) : (
                  <div className="flex gap-2">
                    <ActionForm action={decideCorrectionAction}>
                      <input type="hidden" name="id" value={a.id} />
                      <input type="hidden" name="approve" value="yes" />
                      <Submit small>Apply correction</Submit>
                    </ActionForm>
                    <ActionForm action={decideCorrectionAction}>
                      <input type="hidden" name="id" value={a.id} />
                      <input type="hidden" name="approve" value="no" />
                      <Submit small variant="secondary">Reject</Submit>
                    </ActionForm>
                  </div>
                )}
              </Card>
            ))}
          </ul>
        </Section>
      )}

      {i.disputes.length > 0 && (
        <Section title="Review requests">
          <ul className="space-y-3">
            {i.disputes.map(({ d, member }) => (
              <Card key={d.id} who={member.displayName} color={member.avatarColor} title={d.subjectLabel ?? d.subjectType} meta={`${member.displayName}, ${formatDate(d.createdAt, tz)}`}>
                <p className="mb-2 text-sm">{d.explanation}</p>
                <ActionForm action={resolveDisputeAction} className="flex gap-2">
                  <input type="hidden" name="id" value={d.id} />
                  <input name="outcome" className="input" required placeholder="What you decided" />
                  <Submit small>Record outcome</Submit>
                </ActionForm>
                <p className="mt-1 text-xs text-muted">If Points need to change, use a correction on <Link href={`/admin/members/${member.id}`} className="underline">{member.displayName}'s account</Link>.</p>
              </Card>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}
