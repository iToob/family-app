import Link from "next/link";
import { getDb } from "@/db";
import { requireViewer } from "@/server/auth";
import { listAvailableJobs, listMyClaims } from "@/server/jobs";
import { categories } from "@/server/queries";
import { claimJobAction } from "@/app/actions";
import { ActionForm, Submit } from "@/components/forms";
import { Empty, PageHeader, Points, Row, Rows, Section, Status } from "@/components/ui";
import { ViewOnlyNote } from "@/components/money-bits";

const SORTS = [
  ["reward", "Highest reward"],
  ["quick", "Quick jobs"],
] as const;

export default async function Earn({ searchParams }: { searchParams: Promise<{ sort?: string; cat?: string }> }) {
  const sp = await searchParams;
  const v = await requireViewer();
  const db = getDb();
  const actor = { ...v.actor, memberId: v.subjectId, role: "CHILD" as const };
  const [jobs, mine, cats] = await Promise.all([
    listAvailableJobs(db, actor),
    listMyClaims(db, actor, ["CLAIMED", "IN_PROGRESS", "RETURNED", "SUBMITTED"]),
    categories(db, v.householdId, "JOB"),
  ]);
  let list = jobs;
  if (sp.cat) list = list.filter((j) => j.category_name === sp.cat);
  if (sp.sort === "quick") list = [...list].filter((j) => (j.estimated_minutes ?? 999) <= 30).sort((a, b) => (a.estimated_minutes ?? 0) - (b.estimated_minutes ?? 0));
  const usedCats = cats.filter((c) => jobs.some((j) => j.category_name === c.name));
  const canAct = !v.readOnly;

  const chip = (href: string, label: string, active: boolean) => (
    <Link
      key={href}
      href={href}
      className={`rounded-full px-3 py-1.5 text-sm whitespace-nowrap ${active ? "bg-euc text-white" : "bg-surface text-ink ring-1 ring-line"}`}
    >
      {label}
    </Link>
  );

  return (
    <>
      <PageHeader
        title="Earn"
        subtitle="Do useful work, get paid in Points."
        action={canAct ? <Link href="/earn/propose" className="btn btn-secondary btn-small">Propose a job</Link> : undefined}
      />
      {v.readOnly && !v.previewing && <ViewOnlyNote />}

      {mine.length > 0 && (
        <Section title="Your jobs">
          <Rows>
            {mine.map(({ claim, occ }) => (
              <Row key={claim.id} href={`/earn/claim/${claim.id}`}>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{occ.title}</div>
                  <Status value={claim.status} />
                </div>
                <Points value={occ.rewardPoints} className="font-semibold" />
              </Row>
            ))}
          </Rows>
        </Section>
      )}

      <Section title="Job board">
        <div className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1">
          {chip("/earn", "All", !sp.sort && !sp.cat)}
          {SORTS.map(([k, l]) => chip(`/earn?sort=${k}`, l, sp.sort === k))}
          {usedCats.map((c) => chip(`/earn?cat=${encodeURIComponent(c.name)}`, `${c.icon} ${c.name}`, sp.cat === c.name))}
        </div>
        {list.length === 0 ? (
          <Empty action={canAct ? <Link href="/earn/propose" className="btn btn-primary btn-small">Propose a job</Link> : undefined}>
            No open jobs right now. Got an idea for something useful? Propose it.
          </Empty>
        ) : (
          <ul className="space-y-3">
            {list.map((j) => (
              <li key={j.occurrence_id} className="panel px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-display text-[1.1rem] font-semibold">{j.title}</h3>
                    <p className="mt-0.5 text-sm text-muted">
                      {[
                        j.category_name && `${j.category_icon} ${j.category_name}`,
                        j.estimated_minutes && `about ${j.estimated_minutes} min`,
                        j.difficulty.charAt(0) + j.difficulty.slice(1).toLowerCase(),
                        j.recurrence !== "NONE" && j.recurrence.toLowerCase(),
                      ]
                        .filter(Boolean)
                        .join(", ")}
                    </p>
                  </div>
                  <Points value={j.reward_points} size={18} className="font-display text-lg font-semibold" />
                </div>
                {j.description && <p className="mt-2 text-sm">{j.description}</p>}
                {j.requirements && <p className="mt-1 text-xs text-muted">Suits: {j.requirements}</p>}
                <div className="mt-3 flex items-center justify-between gap-3">
                  <span className="text-xs text-muted">
                    {j.positions > 1 ? `${j.positions - j.taken} of ${j.positions} spots left` : j.kind === "PROJECT" ? "Project milestone" : "1 spot"}
                    {j.due_at ? `, due ${new Date(j.due_at).toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone: v.timezone })}` : ""}
                  </span>
                  {canAct && (
                    <ActionForm action={claimJobAction}>
                      <input type="hidden" name="occurrenceId" value={j.occurrence_id} />
                      <Submit small>Claim</Submit>
                    </ActionForm>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <p className="text-center text-sm">
        <Link href="/earn/proposals" className="text-euc">Your proposals</Link>
      </p>
    </>
  );
}
