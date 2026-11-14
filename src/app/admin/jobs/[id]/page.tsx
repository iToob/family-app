import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { earningOpportunity, householdMember, jobClaim, jobOccurrence } from "@/db/schema";
import { requireParentSession } from "@/server/auth";
import { getSettings } from "@/server/core";
import { categories } from "@/server/queries";
import { jobStatusAction, updateJobAction } from "../../../actions";
import { ActionForm, Submit } from "@/components/forms";
import { JobFields } from "@/components/job-form";
import { PageHeader, Panel, Points, Section, Status } from "@/components/ui";
import { formatDate } from "@/lib/time";

export default async function EditJob({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireParentSession();
  const db = getDb();
  const [opp] = await db.select().from(earningOpportunity).where(and(eq(earningOpportunity.id, id), eq(earningOpportunity.householdId, s.actor.householdId)));
  if (!opp) notFound();
  const [cats, st, occs] = await Promise.all([
    categories(db, s.actor.householdId, "JOB"),
    getSettings(db, s.actor.householdId),
    db.select().from(jobOccurrence).where(eq(jobOccurrence.opportunityId, id)).orderBy(desc(jobOccurrence.createdAt)).limit(30),
  ]);
  const claims = occs.length
    ? await db
        .select({ claim: jobClaim, member: householdMember, occId: jobClaim.occurrenceId })
        .from(jobClaim)
        .innerJoin(householdMember, eq(jobClaim.memberId, householdMember.id))
        .innerJoin(jobOccurrence, eq(jobClaim.occurrenceId, jobOccurrence.id))
        .where(eq(jobOccurrence.opportunityId, id))
    : [];
  return (
    <>
      <PageHeader title={opp.title} back="/admin/jobs" subtitle={<Status value={opp.status} />} />
      <Section title="Occurrences and claims">
        <ul className="panel rows overflow-hidden">
          {occs.map((o) => {
            const cs = claims.filter((c) => c.occId === o.id);
            return (
              <li key={o.id} className="px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-medium">{o.title}</div>
                    <div className="text-xs text-muted">{o.periodKey === "once" ? "One-off" : o.periodKey.startsWith("m:") ? "Milestone" : `Period from ${o.periodKey}`}{o.dueAt ? `, due ${formatDate(o.dueAt, s.timezone)}` : ""}</div>
                  </div>
                  <Points value={o.rewardPoints} size={14} />
                  <Status value={o.status} />
                </div>
                {cs.map(({ claim, member }) => (
                  <Link key={claim.id} href={`/admin/jobs/claim/${claim.id}`} className="mt-2 flex items-center justify-between rounded-lg bg-paper px-3 py-1.5 text-sm">
                    <span>{member.displayName}</span>
                    <Status value={claim.status} />
                  </Link>
                ))}
              </li>
            );
          })}
        </ul>
      </Section>
      <Section title="Edit">
        <Panel className="px-4 py-5 sm:px-6">
          <ActionForm action={updateJobAction}>
            <JobFields cats={cats} opp={opp} guidelines={st.rewardGuidelines} />
          </ActionForm>
        </Panel>
      </Section>
      <div className="flex gap-2">
        {opp.status !== "ARCHIVED" && (
          <ActionForm action={jobStatusAction} confirm="Archive this job? Work already claimed can still be completed and paid.">
            <input type="hidden" name="id" value={opp.id} />
            <input type="hidden" name="status" value="ARCHIVED" />
            <Submit variant="danger" small>Archive</Submit>
          </ActionForm>
        )}
      </div>
    </>
  );
}
