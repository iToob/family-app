import { getDb } from "@/db";
import { requireParentSession } from "@/server/auth";
import { categories } from "@/server/queries";
import { createItemAction } from "../../../actions";
import { ActionForm } from "@/components/forms";
import { ItemFields } from "@/components/item-form";
import { PageHeader, Panel } from "@/components/ui";

export default async function NewItem() {
  const s = await requireParentSession();
  const cats = await categories(getDb(), s.actor.householdId, "MARKET");
  return (
    <>
      <PageHeader title="New marketplace item" back="/admin/marketplace" />
      <Panel className="px-4 py-5 sm:px-6">
        <ActionForm action={createItemAction}>
          <ItemFields cats={cats} />
        </ActionForm>
      </Panel>
    </>
  );
}
