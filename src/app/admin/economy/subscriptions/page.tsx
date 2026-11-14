import { getDb } from "@/db";
import { requireParentSession } from "@/server/auth";
import { householdSubscriptions } from "@/server/queries";
import { subscriptionAction } from "../../../actions";
import { ActionForm, Submit } from "@/components/forms";
import { Empty, PageHeader, Points, Status } from "@/components/ui";
import { formatDate } from "@/lib/time";

export default async function Subs() {
  const s = await requireParentSession();
  const rows = await householdSubscriptions(getDb(), s.actor.householdId);
  const btn = (id: string, action: string, label: string, danger = false) => (
    <ActionForm action={subscriptionAction} confirm={action === "CANCEL" ? "Cancel this subscription?" : undefined}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="action" value={action} />
      <Submit small variant={danger ? "danger" : "secondary"}>{label}</Submit>
    </ActionForm>
  );
  return (
    <>
      <PageHeader title="Subscriptions" back="/admin/economy" />
      {rows.length === 0 && <Empty>No subscriptions yet.</Empty>}
      <ul className="space-y-2">
        {rows.map(({ sub, member }) => (
          <li key={sub.id} className="panel px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-medium">{member.displayName}: {sub.name}</div>
                <div className="text-xs text-muted">
                  {sub.frequency.toLowerCase()}, next {formatDate(sub.nextDueAt, s.timezone)}{sub.autoRenew ? "" : ", not renewing"}
                  {sub.graceUntil && sub.status === "GRACE" ? `, grace until ${formatDate(sub.graceUntil, s.timezone)}` : ""}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <Points value={sub.pricePoints} size={14} />
                <Status value={sub.status} />
              </div>
            </div>
            {sub.status !== "CANCELLED" && (
              <div className="mt-2 flex gap-2">
                {sub.status === "PAUSED" ? btn(sub.id, "RESUME", "Resume") : btn(sub.id, "PAUSE", "Pause")}
                {btn(sub.id, "CANCEL", "Cancel", true)}
              </div>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
