import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { jobApproval } from "@/db/schema";
import { requireParentSession } from "@/server/auth";
import { claimDetail } from "@/server/queries";
import { releaseClaimAction, reviewJobAction } from "../../../../actions";
import { ActionForm, Field, Submit } from "@/components/forms";
import { PageHeader, Panel, Points, Section, Status } from "@/components/ui";
import { formatDate } from "@/lib/time";

export default async function ReviewClaim({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireParentSession();
  const db = getDb();
  const d = await claimDetail(db, s.actor.householdId, id);
  if (!d) notFound();
  const approvals = await db.select().from(jobApproval).where(eq(jobApproval.claimId, id)).orderBy(desc(jobApproval.decidedAt));
  return (
    <>
      <PageHeader title={d.occ.title} back="/admin/approvals" subtitle={<>{d.member.displayName} <Status value={d.claim.status} /></>} />
      <Panel className="mb-5 px-4 py-4">
        <div className="flex justify-between"><span className="text-muted">Reward</span><Points value={d.occ.rewardPoints} className="font-semibold" /></div>
        {d.opp.instructions && <p className="mt-2 text-sm"><strong>Expectations:</strong> {d.opp.instructions}</p>}
      </Panel>
      <Section title="Submissions">
        <ul className="panel rows">
          {d.submissions.map((x) => (
            <li key={x.id} className="px-4 py-3 text-sm">
              <div className="text-muted">{formatDate(x.submittedAt, s.timezone, true)}{x.minutesSpent ? `, ${x.minutesSpent} min` : ""}</div>
              {x.notes && <p className="mt-1">{x.notes}</p>}
              {x.hasPhoto && <img src={`/api/photo/${x.id}`} alt="Submitted work" className="mt-2 max-h-80 rounded-lg" />}
            </li>
          ))}
          {d.submissions.length === 0 && <li className="px-4 py-3 text-sm text-muted">Not submitted yet.</li>}
        </ul>
      </Section>
      {d.claim.status === "SUBMITTED" && (
        <Section title="Decision">
          <Panel className="space-y-4 px-4 py-4">
            <ActionForm action={reviewJobAction}>
              <input type="hidden" name="claimId" value={id} />
              <input type="hidden" name="decision" value="APPROVED" />
              <Submit className="w-full">Approve and pay {d.occ.rewardPoints.toLocaleString("en-AU")} Points</Submit>
            </ActionForm>
            <ActionForm action={reviewJobAction} className="space-y-3 border-t border-line pt-4">
              <input type="hidden" name="claimId" value={id} />
              <Field label="Reason (required for anything other than full approval)">
                <input name="reason" className="input" placeholder="What needs fixing, or why" />
              </Field>
              <Field label="Partial payment Points (only for an agreed partial payment)">
                <input name="points" className="input w-32" inputMode="numeric" />
              </Field>
              <div className="flex flex-wrap gap-2">
                <Submit small variant="secondary" name="decision" value="RETURNED">Send back for fixes</Submit>
                <Submit small variant="secondary" name="decision" value="PARTIAL">Pay partially</Submit>
                <Submit small variant="danger" name="decision" value="REJECTED">Reject</Submit>
              </div>
            </ActionForm>
          </Panel>
        </Section>
      )}
      {["CLAIMED", "IN_PROGRESS", "RETURNED"].includes(d.claim.status) && (
        <ActionForm action={releaseClaimAction} confirm="Release this claim so the job is available again?">
          <input type="hidden" name="claimId" value={id} />
          <Submit small variant="secondary">Release claim</Submit>
        </ActionForm>
      )}
      {approvals.length > 0 && (
        <Section title="History">
          <ul className="panel rows text-sm">
            {approvals.map((a) => (
              <li key={a.id} className="flex justify-between gap-3 px-4 py-2.5">
                <span>{a.decision.toLowerCase()}{a.reason ? `: ${a.reason}` : ""}</span>
                <span className="text-muted">{formatDate(a.decidedAt, s.timezone, true)}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}
