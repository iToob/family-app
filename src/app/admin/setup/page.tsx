import Link from "next/link";
import { eq, sql } from "drizzle-orm";
import { earningOpportunity, marketplaceItem } from "@/db/schema";
import { getDb } from "@/db";
import { requireParentSession } from "@/server/auth";
import { getHousehold, getSettings } from "@/server/core";
import { members } from "@/server/queries";
import { activateAction, addMemberAction } from "../../actions";
import { ActionForm, Field, Submit } from "@/components/forms";
import { Avatar, PageHeader, Panel, Section } from "@/components/ui";
import { describeRate } from "@/lib/money";

export default async function Setup() {
  const s = await requireParentSession();
  const db = getDb();
  const [ms, h, st] = await Promise.all([members(db, s.actor.householdId), getHousehold(db, s.actor.householdId), getSettings(db, s.actor.householdId)]);
  const [{ jobCount }] = await db.select({ jobCount: sql<number>`count(*)::int` }).from(earningOpportunity).where(eq(earningOpportunity.householdId, s.actor.householdId));
  const [{ itemCount }] = await db.select({ itemCount: sql<number>`count(*)::int` }).from(marketplaceItem).where(eq(marketplaceItem.householdId, s.actor.householdId));
  const parents = ms.filter((m) => m.role === "PARENT");
  const kids = ms.filter((m) => m.role === "CHILD");
  const steps = [
    { done: parents.length >= 2, label: "Add the second parent" },
    { done: kids.length >= 1, label: "Add the children" },
    { done: true, label: "Review the family charter", href: "/admin/settings/charter" },
    { done: jobCount > 0 && itemCount > 0, label: "Add some jobs and marketplace items", href: "/admin/jobs" },
    { done: !!h.activatedAt, label: "Go live" },
  ];
  return (
    <>
      <PageHeader title="Set up your economy" subtitle="A few steps and you're running." back="/admin" />
      <ol className="mb-6 space-y-2">
        {steps.map((x, i) => (
          <li key={i} className="flex items-center gap-3">
            <span className={`flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold ${x.done ? "bg-credit text-white" : "bg-line text-muted"}`}>{x.done ? "✓" : i + 1}</span>
            {x.href ? <Link href={x.href} className="text-euc underline">{x.label}</Link> : <span>{x.label}</span>}
          </li>
        ))}
      </ol>

      <Section title="People">
        <ul className="panel rows mb-3">
          {ms.map((m) => (
            <li key={m.id} className="flex items-center gap-3 px-4 py-3">
              <Avatar name={m.displayName} color={m.avatarColor} />
              <span className="flex-1 font-medium">{m.displayName}</span>
              <span className="text-sm text-muted">{m.role === "PARENT" ? "Parent (admin)" : "Child"}</span>
            </li>
          ))}
        </ul>
        <Panel className="px-4 py-4">
          <h3 className="mb-3 font-semibold">Add a person</h3>
          <ActionForm key={ms.length} action={addMemberAction} className="grid gap-3 sm:grid-cols-2" resetOnSuccess>
            <Field label="Name"><input name="displayName" className="input" required /></Field>
            <Field label="Role">
              <select name="role" className="input" defaultValue={parents.length < 2 ? "PARENT" : "CHILD"}>
                <option value="PARENT">Parent (full admin)</option>
                <option value="CHILD">Child</option>
              </select>
            </Field>
            <Field label="Username"><input name="username" className="input" autoCapitalize="none" required /></Field>
            <Field label="Temporary password" hint="They'll choose their own when they first sign in.">
              <input name="password" className="input" required minLength={8} autoComplete="off" />
            </Field>
            <div className="sm:col-span-2"><Submit>Add person</Submit></div>
          </ActionForm>
        </Panel>
      </Section>

      <Section title="Go live">
        <Panel className="px-4 py-4">
          <p className="text-sm">
            Exchange rate: <strong>{describeRate(st.centsPerPoint)}</strong>. Once live, the rate can be raised but never lowered, so Points already earned keep their value. Opening balances can be added from the dashboard with "Add Points".
          </p>
          {h.activatedAt ? (
            <p className="mt-3 font-semibold text-credit">The economy is live.</p>
          ) : (
            <ActionForm action={activateAction} className="mt-3" confirm="Go live? The exchange rate will be locked against decreases.">
              <Submit>Go live</Submit>
            </ActionForm>
          )}
        </Panel>
      </Section>
    </>
  );
}
