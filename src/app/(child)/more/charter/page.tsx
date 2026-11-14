import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { charterAcknowledgement, householdMember } from "@/db/schema";
import { requireViewer } from "@/server/auth";
import { latestCharter } from "@/server/household";
import { acknowledgeAction } from "@/app/actions";
import { ActionForm, Submit } from "@/components/forms";
import { CharterText, PageHeader, Panel } from "@/components/ui";
import { describeRate } from "@/lib/money";
import { formatDate } from "@/lib/time";

export default async function Charter() {
  const v = await requireViewer();
  const db = getDb();
  const c = await latestCharter(db, v.householdId);
  if (!c) return <PageHeader title="Family charter" subtitle="Not published yet." />;
  const [[ack], [me]] = await Promise.all([
    db.select().from(charterAcknowledgement).where(and(eq(charterAcknowledgement.charterVersionId, c.id), eq(charterAcknowledgement.memberId, v.subjectId))),
    db.select().from(householdMember).where(eq(householdMember.id, v.subjectId)),
  ]);
  return (
    <>
      <PageHeader title={c.title} back="/more" subtitle={`Version ${c.version}, published ${formatDate(c.publishedAt, v.timezone)}`} />
      {c.changeSummary && c.version > 1 && <p className="mb-4 rounded-xl bg-brass-100 px-4 py-3 text-sm">What changed: {c.changeSummary}</p>}
      <Panel className="px-5 py-3">
        <CharterText body={c.body} rate={describeRate(v.centsPerPoint)} />
      </Panel>
      {!v.previewing && (
        <Panel className="mt-5 px-5 py-4">
          {ack ? (
            <p className="text-sm">
              You acknowledged this version on {formatDate(ack.acknowledgedAt, v.timezone)}.
            </p>
          ) : (
            <p className="mb-3 text-sm">Please confirm you've read and understood these rules. This isn't a legal contract. It records that we're on the same page.</p>
          )}
          {(!ack || me.participationStatus === "NOT_PARTICIPATING") && (
            <div className="mt-3 space-y-2">
              <ActionForm action={acknowledgeAction}>
                <input type="hidden" name="versionId" value={c.id} />
                <input type="hidden" name="choice" value="ACTIVE" />
                <Submit className="w-full">I understand, and I want to take part</Submit>
              </ActionForm>
              {!ack && (
                <ActionForm action={acknowledgeAction}>
                  <input type="hidden" name="versionId" value={c.id} />
                  <input type="hidden" name="choice" value="NOT_PARTICIPATING" />
                  <Submit variant="secondary" className="w-full">I understand, but not right now</Submit>
                </ActionForm>
              )}
            </div>
          )}
        </Panel>
      )}
    </>
  );
}
