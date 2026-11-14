import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { marketplaceItem } from "@/db/schema";
import { requireParentSession } from "@/server/auth";
import { categories } from "@/server/queries";
import { archiveItemAction, updateItemAction } from "../../../actions";
import { ActionForm, Submit } from "@/components/forms";
import { ItemFields } from "@/components/item-form";
import { PageHeader, Panel } from "@/components/ui";

export default async function EditItem({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireParentSession();
  const db = getDb();
  const [item] = await db.select().from(marketplaceItem).where(and(eq(marketplaceItem.id, id), eq(marketplaceItem.householdId, s.actor.householdId)));
  if (!item) notFound();
  const cats = await categories(db, s.actor.householdId, "MARKET");
  return (
    <>
      <PageHeader title={item.name} back="/admin/marketplace" subtitle="Price changes apply to new purchases. Existing subscriptions keep their agreed price." />
      <Panel className="mb-4 px-4 py-5 sm:px-6">
        <ActionForm action={updateItemAction}>
          <ItemFields cats={cats} item={item} />
        </ActionForm>
      </Panel>
      {!item.archivedAt && (
        <ActionForm action={archiveItemAction} confirm="Archive this item? It disappears from the marketplace. Past purchases are kept.">
          <input type="hidden" name="id" value={item.id} />
          <input type="hidden" name="archived" value="yes" />
          <Submit small variant="danger">Archive item</Submit>
        </ActionForm>
      )}
    </>
  );
}
