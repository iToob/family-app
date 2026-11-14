import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { requireViewer } from "@/server/auth";
import { claimDetail } from "@/server/queries";
import { jobApproval } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { releaseClaimAction, startJobAction, submitJobAction, disputeAction } from "@/app/actions";
import { ActionForm, Field, PhotoInput, Submit } from "@/components/forms";
import { Notice, PageHeader, Panel, Points, Section, Status } from "@/components/ui";
import { formatDate } from "@/lib/time";

export default async function ClaimPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ claimed?: string }> }) {
  const { id } = await params;
  const { claimed } = await searchParams;
  const v = await requireViewer();
  const db = getDb();
  const d = await claimDetail(db, v.householdId, id);
  if (!d || d.claim.memberId !== v.subjectId) notFound();
  const approvals = await db.select().from(jobApproval).where(eq(jobApproval.claimId, id)).orderBy(desc(jobApproval.decidedAt));
  const last = approvals[0];
  const canWork = !v.readOnly && ["CLAIMED", "IN_PROGRESS", "RETURNED"].includes(d.claim.status);
  const o = d.opp;
  const info: [string, string | null | undefined][] = [
    ["Instructions and quality", o.instructions],
    ["Where", o.location],
    ["Equipment", o.equipment],
    ["Safety", o.safetyNotes],
    ["Suits", o.requirements],
  ];
  return (
    <>
      <PageHeader title={d.occ.title} back="/earn" subtitle={<Status value={d.claim.status} />} />
      {claimed && d.claim.status === "CLAIMED" && <Notice>Job claimed. It's yours! Submit it here when you're done.</Notice>}
      <Panel className="mb-5 px-4 py-4">
        <div className="flex items-center justify-between">
          <span className="text-muted">Reward</span>
          <Points value={d.occ.rewardPoints} size={20} className="font-display text-xl font-semibold" />
        </div>
        {o.description && <p className="mt-3">{o.description}</p>}
        <dl className="mt-3 space-y-2 text-sm">
          {info.filter(([, x]) => x).map(([k, x]) => (
            <div key={k}>
              <dt className="font-medium">{k}</dt>
              <dd className="text-muted whitespace-pre-line">{x}</dd>
            </div>
          ))}
          {d.occ.dueAt && (
            <div>
              <dt className="font-medium">Due</dt>
              <dd className="text-muted">{formatDate(d.occ.dueAt, v.timezone, true)}</dd>
            </div>
          )}
        </dl>
      </Panel>

      {last && ["RETURNED", "REJECTED", "PARTIAL"].includes(last.decision) && (
        <Notice tone={last.decision === "REJECTED" ? "danger" : "warn"}>
          <strong>{last.decision === "RETURNED" ? "Needs a few fixes: " : last.decision === "PARTIAL" ? "Partly paid: " : "Not approved: "}</strong>
          {last.reason}
        </Notice>
      )}

      {d.claim.status === "SUBMITTED" && <Notice>Submitted for approval. You'll get a notification when a parent has checked it.</Notice>}
      {d.claim.status === "PAID" && <Notice>Approved and paid. Nice work.</Notice>}

      {canWork && (
        <Section title="Finished?">
          <Panel className="px-4 py-4">
            <ActionForm action={submitJobAction} className="space-y-4">
              <input type="hidden" name="claimId" value={id} />
              <Field label="Notes (optional)">
                <textarea name="notes" className="input" placeholder="Anything your parents should know" />
              </Field>
              <Field label="Time spent in minutes (optional)">
                <input name="minutesSpent" className="input w-32" inputMode="numeric" />
              </Field>
              <Field label="Photo (optional)">
                <PhotoInput name="photo" />
              </Field>
              <Submit className="w-full">Submit for approval</Submit>
            </ActionForm>
          </Panel>
          <div className="mt-3 flex justify-between">
            {d.claim.status === "CLAIMED" && (
              <ActionForm action={startJobAction}>
                <input type="hidden" name="claimId" value={id} />
                <Submit variant="secondary" small>Mark as started</Submit>
              </ActionForm>
            )}
            <ActionForm action={releaseClaimAction} confirm="Give this job back so someone else can do it?">
              <input type="hidden" name="claimId" value={id} />
              <Submit variant="danger" small>Give job back</Submit>
            </ActionForm>
          </div>
        </Section>
      )}

      {d.submissions.length > 0 && (
        <Section title="Submissions">
          <Panel className="rows">
            {d.submissions.map((s) => (
              <div key={s.id} className="px-4 py-3 text-sm">
                <div className="text-muted">{formatDate(s.submittedAt, v.timezone, true)}</div>
                {s.notes && <p>{s.notes}</p>}
                {s.hasPhoto && <img src={`/api/photo/${s.id}`} alt="Submitted work" className="mt-2 max-h-56 rounded-lg" />}
              </div>
            ))}
          </Panel>
        </Section>
      )}

      {!v.previewing && ["REJECTED", "PAID"].includes(d.claim.status) && (
        <details className="panel px-4 py-3">
          <summary className="font-medium text-euc">Ask for a review</summary>
          <ActionForm action={disputeAction} className="mt-3 space-y-3" onSuccessClose>
            <input type="hidden" name="subjectType" value="JOB" />
            <input type="hidden" name="subjectRef" value={id} />
            <input type="hidden" name="subjectLabel" value={d.occ.title} />
            <Field label="What should be reviewed?">
              <textarea name="explanation" className="input" required />
            </Field>
            <Submit small>Send</Submit>
          </ActionForm>
        </details>
      )}
    </>
  );
}
