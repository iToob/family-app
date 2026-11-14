import Link from "next/link";
import { getDb } from "@/db";
import { requireViewer } from "@/server/auth";
import { marketplace, wallet } from "@/server/queries";
import { purchaseAction } from "@/app/actions";
import { ActionForm, IdempotencyKey, Submit } from "@/components/forms";
import { Aud, Empty, PageHeader, Points } from "@/components/ui";
import { ViewOnlyNote } from "@/components/money-bits";

const FREQ: Record<string, string> = { WEEKLY: "week", FORTNIGHTLY: "fortnight", MONTHLY: "month" };

export default async function Spend() {
  const v = await requireViewer();
  const db = getDb();
  const [items, w] = await Promise.all([marketplace(db, v.householdId), wallet(db, v.subjectId)]);
  const groups = new Map<string, { icon: string; items: typeof items }>();
  for (const r of items) {
    const key = r.categoryName ?? "Other";
    if (!groups.has(key)) groups.set(key, { icon: r.categoryIcon ?? "⭐", items: [] });
    groups.get(key)!.items.push(r);
  }
  return (
    <>
      <PageHeader
        title="Spend"
        subtitle={<>You have <Points value={w.available} className="font-semibold text-ink" /> available.</>}
        action={<Link href="/spend/orders" className="btn btn-secondary btn-small">Your orders</Link>}
      />
      {v.readOnly && !v.previewing && <ViewOnlyNote />}
      {items.length === 0 && <Empty>Nothing in the marketplace yet.</Empty>}
      {[...groups.entries()].map(([name, g]) => (
        <section key={name} className="mb-6">
          <h2 className="mb-2 px-1 text-[1.05rem] font-semibold">
            <span aria-hidden>{g.icon}</span> {name}
          </h2>
          <ul className="panel rows overflow-hidden">
            {g.items.map(({ item }) => {
              const short = item.pricePoints - w.available;
              return (
                <li key={item.id} className="px-4 py-3">
                  <div className="flex items-start gap-3">
                    <span className="text-2xl" aria-hidden>{item.icon}</span>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{item.name}</div>
                      {item.description && <p className="text-sm text-muted">{item.description}</p>}
                      <p className="mt-0.5 text-xs text-muted">
                        {item.isSubscription && item.billingFrequency ? `Renews each ${FREQ[item.billingFrequency]}. ` : ""}
                        {item.entitlementDays && !item.isSubscription ? `Lasts ${item.entitlementDays} days. ` : ""}
                        {item.requiresApproval ? "Needs a parent's OK." : "Instant."}
                      </p>
                    </div>
                    <div className="text-right">
                      <Points value={item.pricePoints} className="font-semibold" />
                      <div className="text-xs text-muted">
                        <Aud points={item.pricePoints} rate={v.centsPerPoint} />
                        {item.isSubscription && item.billingFrequency ? `/${FREQ[item.billingFrequency]}` : ""}
                      </div>
                    </div>
                  </div>
                  {!v.readOnly && (
                    <div className="mt-2 flex items-center justify-end gap-3">
                      {short > 0 ? (
                        <p className="text-sm text-muted">
                          {short.toLocaleString("en-AU")} more Points needed. <Link href="/earn?sort=reward" className="text-euc">Find work</Link>
                        </p>
                      ) : (
                        <ActionForm action={purchaseAction} confirm={`Spend ${item.pricePoints.toLocaleString("en-AU")} Points on ${item.name}?`}>
                          <input type="hidden" name="itemId" value={item.id} />
                          <IdempotencyKey />
                          <Submit small>{item.requiresApproval ? "Request" : "Buy"}</Submit>
                        </ActionForm>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </>
  );
}
