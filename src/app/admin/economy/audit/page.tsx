import { getDb } from "@/db";
import { requireParentSession } from "@/server/auth";
import { auditTrail } from "@/server/queries";
import { PageHeader } from "@/components/ui";
import { formatDate } from "@/lib/time";

export default async function Audit() {
  const s = await requireParentSession();
  const rows = await auditTrail(getDb(), s.actor.householdId, 500);
  return (
    <>
      <PageHeader title="Audit log" back="/admin/economy" subtitle="Every sensitive action, who did it and when. This log can't be edited or deleted." />
      <ul className="panel rows text-sm">
        {rows.map(({ log, actorName }) => (
          <li key={log.id} className="px-4 py-2.5">
            <div className="flex justify-between gap-3">
              <span><span className="font-medium">{actorName ?? "System"}</span> {log.action.replaceAll(".", " ").replaceAll("_", " ")}</span>
              <span className="shrink-0 text-muted">{formatDate(log.createdAt, s.timezone, true)}</span>
            </div>
            {log.details != null && (
              <details>
                <summary className="text-xs text-muted">Details</summary>
                <pre className="mt-1 overflow-x-auto rounded bg-paper p-2 text-xs">{JSON.stringify(log.details, null, 2)}</pre>
              </details>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
