import Link from "next/link";
import { getDb } from "@/db";
import { requireParentSession } from "@/server/auth";
import { marketplace } from "@/server/queries";
import { archiveItemAction } from "../../actions";
import { ActionForm, Submit } from "@/components/forms";
import { Aud, Empty, PageHeader, Points, Section, Status } from "@/components/ui";

export default async function AdminMarket() {
  const s = await requireParentSession();
  const rows = await marketplace(getDb(), s.actor.householdId, true);
  const live = rows.filter((r) => !r.item.archivedAt);
  const archived = rows.filter((r) => r.item.archivedAt);
  return (
    <>
      <PageHeader
        title="Marketplace"
        subtitle="What the kids can spend Points on."
        action={
          <div className="flex gap-2">
            <Link href="/admin/marketplace/orders" className="btn btn-secondary btn-small">Orders</Link>
            <Link href="/admin/marketplace/new" className="btn btn-primary btn-small">New item</Link>
          </div>
        }
      />
      {live.length === 0 && <Empty>No items yet.</Empty>}
      {live.length > 0 && (
        <ul className="panel rows overflow-hidden">
          {live.map(({ item, categoryName }) => (
            <li key={item.id} className="flex items-center gap-3 px-4 py-3">
              <span className="text-2xl" aria-hidden>{item.icon}</span>
              <Link href={`/admin/marketplace/${item.id}`} className="min-w-0 flex-1">
                <div className="truncate font-medium">{item.name}</div>
                <div className="text-xs text-muted">
                  {categoryName ?? "Uncategorised"}
                  {item.isSubscription ? `, ${item.billingFrequency?.toLowerCase()} subscription` : ""}
                  {item.requiresApproval ? "" : ", instant"}
                </div>
              </Link>
              {!item.available && <Status value="PAUSED" />}
              <div className="text-right">
                <Points value={item.pricePoints} size={14} className="font-semibold" />
                <div className="text-xs text-muted"><Aud points={item.pricePoints} rate={s.centsPerPoint} /></div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {archived.length > 0 && (
        <Section title="Archived" className="mt-6">
          <ul className="panel rows">
            {archived.map(({ item }) => (
              <li key={item.id} className="flex items-center justify-between px-4 py-2.5">
                <span className="text-muted">{item.icon} {item.name}</span>
                <ActionForm action={archiveItemAction}>
                  <input type="hidden" name="id" value={item.id} />
                  <input type="hidden" name="archived" value="no" />
                  <Submit small variant="secondary">Restore</Submit>
                </ActionForm>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}
