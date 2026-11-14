import Link from "next/link";
import { getDb } from "@/db";
import { requireSession } from "@/server/auth";
import { notifications } from "@/server/queries";
import { markReadAction } from "@/app/actions";
import { Empty, PageHeader } from "@/components/ui";
import { formatDate } from "@/lib/time";

export default async function Notifications() {
  const s = await requireSession();
  const list = await notifications(getDb(), s.actor.memberId, 100);
  const unread = list.some((n) => !n.readAt);
  const back = s.actor.role === "PARENT" ? "/admin" : "/more";
  return (
    <>
      <PageHeader
        title="Notifications"
        back={back}
        action={
          unread ? (
            <form action={markReadAction}>
              <button className="btn btn-secondary btn-small">Mark all read</button>
            </form>
          ) : undefined
        }
      />
      {list.length === 0 ? (
        <Empty>Nothing yet.</Empty>
      ) : (
        <ul className="panel rows overflow-hidden">
          {list.map((n) => (
            <li key={n.id} className={`px-4 py-3 ${n.readAt ? "" : "bg-brass-100/40"}`}>
              <div className="flex items-start gap-3">
                {!n.readAt && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-hold" aria-label="Unread" />}
                <div className="min-w-0 flex-1">
                  {n.link ? (
                    <Link href={n.link} className="font-medium hover:underline">{n.title}</Link>
                  ) : (
                    <div className="font-medium">{n.title}</div>
                  )}
                  {n.body && <p className="text-sm text-muted">{n.body}</p>}
                  <p className="mt-0.5 text-xs text-muted">{formatDate(n.createdAt, s.timezone, true)}</p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
