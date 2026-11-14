import Link from "next/link";
import { getDb } from "@/db";
import { requireParentSession } from "@/server/auth";
import { opportunities } from "@/server/queries";
import { jobStatusAction } from "../../actions";
import { ActionForm, Submit } from "@/components/forms";
import { Empty, PageHeader, Points, Section, Status } from "@/components/ui";

export default async function Jobs() {
  const s = await requireParentSession();
  const list = await opportunities(getDb(), s.actor.householdId);
  const groups = [
    ["Active", list.filter((x) => x.opp.status === "ACTIVE")],
    ["Paused", list.filter((x) => x.opp.status === "PAUSED")],
    ["Archived", list.filter((x) => x.opp.status === "ARCHIVED")],
  ] as const;
  return (
    <>
      <PageHeader title="Jobs" subtitle="Earning opportunities on the job board." action={<Link href="/admin/jobs/new" className="btn btn-primary btn-small">New job</Link>} />
      {list.length === 0 && <Empty action={<Link href="/admin/jobs/new" className="btn btn-primary btn-small">Create the first job</Link>}>No jobs yet.</Empty>}
      {groups.map(([label, rows]) =>
        rows.length ? (
          <Section key={label} title={label}>
            <ul className="panel rows overflow-hidden">
              {rows.map(({ opp, categoryIcon, activeClaims, openOccurrences }) => (
                <li key={opp.id} className="flex items-center gap-3 px-4 py-3">
                  <Link href={`/admin/jobs/${opp.id}`} className="min-w-0 flex-1">
                    <div className="truncate font-medium">{categoryIcon} {opp.title}</div>
                    <div className="text-xs text-muted">
                      {opp.kind === "PROJECT" ? "Project" : opp.recurrence === "NONE" ? "One-off" : `Repeats ${opp.recurrence.toLowerCase()}`}
                      {opp.restrictedToMemberId ? ", proposed by a child" : ""}
                      {activeClaims ? `, ${activeClaims} in progress` : ""}
                      {opp.status === "ACTIVE" && !openOccurrences ? ", none open" : ""}
                    </div>
                  </Link>
                  <Points value={opp.rewardPoints} className="font-semibold" size={14} />
                  {opp.status !== "ACTIVE" && <Status value={opp.status} />}
                  <ActionForm action={jobStatusAction}>
                    <input type="hidden" name="id" value={opp.id} />
                    <input type="hidden" name="status" value={opp.status === "ACTIVE" ? "PAUSED" : "ACTIVE"} />
                    <Submit small variant="secondary">{opp.status === "ACTIVE" ? "Pause" : "Activate"}</Submit>
                  </ActionForm>
                </li>
              ))}
            </ul>
          </Section>
        ) : null,
      )}
    </>
  );
}
