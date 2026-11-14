import type { marketplaceItem } from "@/db/schema";
import { DependsOn, Field, Submit } from "./forms";

type Item = typeof marketplaceItem.$inferSelect;
type Cat = { id: string; name: string; icon: string };

export function ItemFields({ cats, item }: { cats: Cat[]; item?: Item }) {
  return (
    <div className="space-y-4">
      {item && <input type="hidden" name="id" value={item.id} />}
      <div className="flex gap-3">
        <Field label="Icon" className="w-20">
          <input name="icon" className="input text-center" defaultValue={item?.icon ?? "🎁"} maxLength={4} />
        </Field>
        <Field label="Name" className="flex-1">
          <input name="name" className="input" required defaultValue={item?.name} placeholder="Streaming subscription" />
        </Field>
      </div>
      <Field label="Description">
        <textarea name="description" className="input" defaultValue={item?.description} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Category">
          <select name="categoryId" className="input" defaultValue={item?.categoryId ?? ""}>
            <option value="">None</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
          </select>
        </Field>
        <Field label="Price (Points)" hint="For subscriptions, the price per billing period.">
          <input name="pricePoints" className="input" inputMode="numeric" required defaultValue={item?.pricePoints} />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Kind">
          <select name="isSubscription" className="input" defaultValue={item?.isSubscription ? "yes" : "no"}>
            <option value="no">One-off purchase</option>
            <option value="yes">Recurring subscription</option>
          </select>
        </Field>
        <DependsOn field="isSubscription" values={["yes"]}>
          <Field label="Billing">
            <select name="billingFrequency" className="input" defaultValue={item?.billingFrequency ?? "MONTHLY"}>
              <option value="WEEKLY">Weekly</option>
              <option value="FORTNIGHTLY">Fortnightly</option>
              <option value="MONTHLY">Monthly</option>
            </select>
          </Field>
        </DependsOn>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="What happens after purchase">
          <select name="fulfilmentType" className="input" defaultValue={item?.fulfilmentType ?? "MANUAL"}>
            <option value="MANUAL">A parent provides something (track delivery)</option>
            <option value="ENTITLEMENT">A time-limited privilege starts</option>
            <option value="NONE">Nothing to hand over</option>
          </select>
        </Field>
        <DependsOn field="fulfilmentType" values={["ENTITLEMENT"]}>
          <Field label="Privilege lasts (days)" hint="Ignored for subscriptions, which last one billing period.">
            <input name="entitlementDays" className="input" inputMode="numeric" defaultValue={item?.entitlementDays ?? 7} />
          </Field>
        </DependsOn>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Approval">
          <select name="requiresApproval" className="input" defaultValue={item && !item.requiresApproval ? "no" : "yes"}>
            <option value="yes">Needs a parent's OK</option>
            <option value="no">Pre-authorised (instant)</option>
          </select>
        </Field>
        <Field label="Limit per person (optional)">
          <input name="perPersonLimit" className="input" inputMode="numeric" defaultValue={item?.perPersonLimit ?? ""} />
        </Field>
        <Field label="Limit period">
          <select name="limitPeriod" className="input" defaultValue={item?.limitPeriod ?? "WEEK"}>
            <option value="DAY">Per day</option>
            <option value="WEEK">Per week</option>
            <option value="MONTH">Per month</option>
            <option value="EVER">In total</option>
          </select>
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Refundable">
          <select name="refundable" className="input" defaultValue={item && !item.refundable ? "no" : "yes"}>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </Field>
        <Field label="Visible in the marketplace">
          <select name="available" className="input" defaultValue={item && !item.available ? "no" : "yes"}>
            <option value="yes">Yes</option>
            <option value="no">Hidden for now</option>
          </select>
        </Field>
      </div>
      <p className="text-sm text-muted">Privileges are optional extras. Essentials like food, school, medical care and safety are never sold here.</p>
      <Submit>{item ? "Save changes" : "Add to marketplace"}</Submit>
    </div>
  );
}
