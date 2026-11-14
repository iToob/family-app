import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { purchase } from "@/db/schema";
import { requireViewer } from "@/server/auth";
import { disputeAction } from "@/app/actions";
import { ActionForm, Field, Submit } from "@/components/forms";
import { Aud, PageHeader, Points, Status } from "@/components/ui";
import { formatDate } from "@/lib/time";

export default async function Receipt({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const v = await requireViewer();
  const [p] = await getDb().select().from(purchase).where(and(eq(purchase.id, id), eq(purchase.memberId, v.subjectId)));
  if (!p) notFound();
  const lines: [string, React.ReactNode][] = [
    ["Receipt", `#${p.receiptNumber}`],
    ["Item", p.itemName],
    ["Price", <Points key="p" value={p.pricePoints} />],
    ["Value", <Aud key="a" points={p.pricePoints} rate={v.centsPerPoint} />],
    ["Requested", formatDate(p.requestedAt, v.timezone, true)],
    ["Status", <Status key="s" value={p.status} />],
  ];
  if (p.decidedAt) lines.push(["Decided", formatDate(p.decidedAt, v.timezone, true)]);
  if (p.fulfilledAt) lines.push(["Delivered", formatDate(p.fulfilledAt, v.timezone, true)]);
  if (p.decisionReason) lines.push(["Reason", p.decisionReason]);
  if (p.refundedAt) lines.push(["Refunded", `${formatDate(p.refundedAt, v.timezone)}: ${p.refundReason ?? ""}`]);
  return (
    <>
      <PageHeader title="Receipt" back="/spend/orders" />
      <div className="panel px-5 py-5">
        <dl className="space-y-2.5">
          {lines.map(([k, val]) => (
            <div key={k} className="flex justify-between gap-4">
              <dt className="text-muted">{k}</dt>
              <dd className="text-right font-medium">{val}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 border-t border-dashed border-line pt-3 text-xs text-muted">
          Points are deducted when a purchase is approved. Delivery is confirmed separately by a parent.
        </p>
      </div>
      {!v.previewing && (
        <details className="panel mt-4 px-4 py-3">
          <summary className="font-medium text-euc">Something wrong? Ask for a review</summary>
          <ActionForm action={disputeAction} className="mt-3 space-y-3" onSuccessClose>
            <input type="hidden" name="subjectType" value="PURCHASE" />
            <input type="hidden" name="subjectRef" value={p.id} />
            <input type="hidden" name="subjectLabel" value={`Receipt #${p.receiptNumber}: ${p.itemName}`} />
            <Field label="What happened?">
              <textarea name="explanation" className="input" required />
            </Field>
            <Submit small>Send</Submit>
          </ActionForm>
        </details>
      )}
    </>
  );
}
