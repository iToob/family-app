import { getDb } from "@/db";
import { requireViewer } from "@/server/auth";
import { memberPurchases } from "@/server/queries";
import { cancelPurchaseAction } from "@/app/actions";
import { ActionForm, Submit } from "@/components/forms";
import { Empty, PageHeader, Points, Row, Rows, Status } from "@/components/ui";
import { formatDate } from "@/lib/time";

export default async function Orders() {
  const v = await requireViewer();
  const list = await memberPurchases(getDb(), v.subjectId);
  return (
    <>
      <PageHeader title="Your orders" back="/spend" />
      {list.length === 0 ? (
        <Empty>No purchases yet.</Empty>
      ) : (
        <Rows>
          {list.map((p) => (
            <Row key={p.id} href={`/spend/receipt/${p.id}`}>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{p.itemName}</div>
                <div className="text-xs text-muted">
                  #{p.receiptNumber}, {formatDate(p.requestedAt, v.timezone)}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <Points value={p.pricePoints} size={14} />
                <Status value={p.status} />
              </div>
            </Row>
          ))}
        </Rows>
      )}
      {!v.readOnly &&
        list
          .filter((p) => p.status === "REQUESTED")
          .map((p) => (
            <ActionForm key={p.id} action={cancelPurchaseAction} className="mt-3 flex items-center justify-between rounded-xl bg-hold-100 px-4 py-2 text-sm">
              <input type="hidden" name="id" value={p.id} />
              <span>{p.itemName} is waiting for approval.</span>
              <Submit small variant="secondary">Cancel request</Submit>
            </ActionForm>
          ))}
    </>
  );
}
