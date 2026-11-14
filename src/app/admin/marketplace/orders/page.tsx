import { getDb } from "@/db";
import { requireParentSession } from "@/server/auth";
import { householdPurchases } from "@/server/queries";
import { fulfilPurchaseAction, refundPurchaseAction } from "../../../actions";
import { ActionForm, Submit } from "@/components/forms";
import { Empty, PageHeader, Points, Status } from "@/components/ui";
import { formatDate } from "@/lib/time";

export default async function Orders() {
  const s = await requireParentSession();
  const rows = await householdPurchases(getDb(), s.actor.householdId);
  return (
    <>
      <PageHeader title="Orders" back="/admin/marketplace" />
      {rows.length === 0 && <Empty>No purchases yet.</Empty>}
      <ul className="space-y-2">
        {rows.map(({ p, member }) => (
          <li key={p.id} className="panel px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium">{p.itemName}</div>
                <div className="text-xs text-muted">#{p.receiptNumber}, {member.displayName}, {formatDate(p.requestedAt, s.timezone, true)}</div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <Points value={p.pricePoints} size={14} />
                <Status value={p.status} />
              </div>
            </div>
            {(p.status === "AWAITING_FULFILMENT" || p.status === "FULFILLED") && (
              <div className="mt-2 flex flex-wrap items-center gap-3">
                {p.status === "AWAITING_FULFILMENT" && (
                  <ActionForm action={fulfilPurchaseAction}>
                    <input type="hidden" name="id" value={p.id} />
                    <Submit small>Mark as delivered</Submit>
                  </ActionForm>
                )}
                <details>
                  <summary className="text-sm font-medium text-danger">Refund…</summary>
                  <ActionForm action={refundPurchaseAction} className="mt-2 flex gap-2" confirm={`Refund ${p.pricePoints} Points?`}>
                    <input type="hidden" name="id" value={p.id} />
                    <input name="reason" className="input" required placeholder="Reason" />
                    <Submit small variant="danger">Refund</Submit>
                  </ActionForm>
                </details>
              </div>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
