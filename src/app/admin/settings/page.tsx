import Link from "next/link";
import { getDb } from "@/db";
import { requireParentSession } from "@/server/auth";
import { getHousehold, getSettings } from "@/server/core";
import { categories, members } from "@/server/queries";
import { addMemberAction, categoryAction, logoutAction, settingsAction } from "../../actions";
import { ActionForm, Field, Submit, Toggle } from "@/components/forms";
import { Avatar, PageHeader, Panel, Row, Rows, Section, Status } from "@/components/ui";
import { describeRate } from "@/lib/money";

export default async function Settings() {
  const s = await requireParentSession();
  const db = getDb();
  const hid = s.actor.householdId;
  const [h, st, ms, jobCats, marketCats] = await Promise.all([
    getHousehold(db, hid),
    getSettings(db, hid),
    members(db, hid, true),
    categories(db, hid, "JOB"),
    categories(db, hid, "MARKET"),
  ]);
  const ppd = 100 / st.centsPerPoint;
  return (
    <>
      <PageHeader title="Settings" />

      <Section title="People">
        <Rows>
          {ms.map((m) => (
            <Row key={m.id} href={m.role === "CHILD" ? `/admin/members/${m.id}` : `/admin/members/${m.id}`}>
              <Avatar name={m.displayName} color={m.avatarColor} />
              <span className="flex-1 font-medium">{m.displayName}{m.id === s.actor.memberId ? " (you)" : ""}</span>
              <span className="text-sm text-muted">{m.role === "PARENT" ? "Parent" : "Child"}</span>
              {m.archivedAt ? <Status value="ARCHIVED" /> : m.role === "CHILD" ? <Status value={m.participationStatus} /> : null}
            </Row>
          ))}
        </Rows>
        <details className="panel mt-3 px-4 py-3">
          <summary className="font-medium text-euc">Add a person</summary>
          <ActionForm action={addMemberAction} className="mt-3 grid gap-3 sm:grid-cols-2" resetOnSuccess>
            <Field label="Name"><input name="displayName" className="input" required /></Field>
            <Field label="Role">
              <select name="role" className="input" defaultValue="CHILD">
                <option value="PARENT">Parent (full admin)</option>
                <option value="CHILD">Child</option>
              </select>
            </Field>
            <Field label="Username"><input name="username" className="input" autoCapitalize="none" required /></Field>
            <Field label="Temporary password"><input name="password" className="input" required minLength={8} autoComplete="off" /></Field>
            <div className="sm:col-span-2"><Submit>Add person</Submit></div>
          </ActionForm>
        </details>
      </Section>

      <Section title="What the kids can do">
        <Panel className="px-4 py-4">
          <ActionForm action={settingsAction} className="space-y-3">
            <Toggle
              name="childRequestsEnabled"
              defaultChecked={st.childRequestsEnabled}
              label="Kids can make requests"
              hint="Off: kids can only view. You record jobs, spends and cash-outs for them. On: they can claim jobs, request purchases, cash out and manage savings. Anything that needs approval still waits for you."
            />
            <Submit small>Save</Submit>
          </ActionForm>
        </Panel>
      </Section>

      <Section title="Economy rules">
        <Panel className="px-4 py-4">
          <ActionForm action={settingsAction} className="space-y-4">
            <Field label="Household name"><input name="householdName" className="input" defaultValue={h.name} /></Field>
            <Field
              label="Exchange rate"
              hint={h.activatedAt ? "The economy is live, so the rate can only be raised (fewer Points per dollar), never lowered." : "Set this before you go live."}
            >
              <div className="flex items-center gap-2">
                <input name="pointsPerDollar" className="input w-24" inputMode="numeric" defaultValue={ppd} />
                <span>Points = $1.00 (currently {describeRate(st.centsPerPoint)})</span>
              </div>
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Minimum cash-out (Points)"><input name="minCashOutPoints" className="input" inputMode="numeric" defaultValue={st.minCashOutPoints} /></Field>
              <Field label="Maximum per cash-out (Points, optional)"><input name="maxCashOutPoints" className="input" inputMode="numeric" defaultValue={st.maxCashOutPoints ?? ""} /></Field>
            </div>
            <Field label="Cash-out methods" hint="Comma separated"><input name="cashOutMethods" className="input" defaultValue={st.cashOutMethods.join(", ")} /></Field>
            <Field label="Payout schedule (shown to kids)"><input name="payoutSchedule" className="input" defaultValue={st.payoutSchedule} /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Weekly issuance target (optional)" hint="Shows a warning when earnings plus commitments exceed it. Never blocks payments."><input name="weeklyBudgetPoints" className="input" inputMode="numeric" defaultValue={st.weeklyBudgetPoints ?? ""} /></Field>
              <Field label="Monthly issuance target (optional)"><input name="monthlyBudgetPoints" className="input" inputMode="numeric" defaultValue={st.monthlyBudgetPoints ?? ""} /></Field>
            </div>
            <Field label="Subscription grace period (days)" hint="How long a failed renewal keeps retrying before the privilege lapses."><input name="subscriptionGraceDays" className="input w-24" inputMode="numeric" defaultValue={st.subscriptionGraceDays} /></Field>
            <Field label="Reward guidelines (shown when creating jobs)"><input name="rewardGuidelines" className="input" defaultValue={st.rewardGuidelines} /></Field>
            <Toggle name="pauseSubscriptionsOnPause" defaultChecked={st.pauseSubscriptionsOnPause} label="Pause subscriptions when a child pauses participation" />
            <Toggle name="correctionsNeedSecondParent" defaultChecked={st.correctionsNeedSecondParent} label="Deductions need the other parent's approval" hint="When on, a correction that removes Points waits for the other parent." />
            <Submit>Save rules</Submit>
          </ActionForm>
        </Panel>
      </Section>

      <Section title="Family charter" action={<Link href="/admin/settings/charter" className="text-sm text-euc">Edit and publish</Link>}>
        <Panel className="px-4 py-3 text-sm text-muted">The plain-language rules every child reads and acknowledges.</Panel>
      </Section>

      <div className="grid gap-6 md:grid-cols-2">
        {([["JOB", "Job categories", jobCats], ["MARKET", "Marketplace categories", marketCats]] as const).map(([kind, title, cats]) => (
          <Section key={kind} title={title}>
            <ul className="panel rows">
              {cats.map((c) => (
                <li key={c.id} className="px-3 py-2">
                  <ActionForm action={categoryAction} className="flex items-center gap-2">
                    <input type="hidden" name="id" value={c.id} />
                    <input type="hidden" name="kind" value={kind} />
                    <input name="icon" defaultValue={c.icon} className="input w-14 text-center" aria-label="Icon" />
                    <input name="name" defaultValue={c.name} className="input" aria-label="Name" />
                    <Submit small variant="secondary">Save</Submit>
                    <Submit small variant="secondary" name="archived" value="yes">Remove</Submit>
                  </ActionForm>
                </li>
              ))}
              <li className="px-3 py-2">
                <ActionForm action={categoryAction} className="flex items-center gap-2" resetOnSuccess>
                  <input type="hidden" name="kind" value={kind} />
                  <input name="icon" placeholder="🙂" className="input w-14 text-center" aria-label="Icon" />
                  <input name="name" placeholder="New category" className="input" aria-label="Name" required />
                  <Submit small>Add</Submit>
                </ActionForm>
              </li>
            </ul>
          </Section>
        ))}
      </div>

      <Section>
        <div className="flex flex-wrap gap-2">
          <Link href="/change-password" className="btn btn-secondary">Change my password</Link>
          <Link href="/admin/notifications" className="btn btn-secondary">My notifications</Link>
          <form action={logoutAction}><button className="btn btn-secondary">Sign out</button></form>
        </div>
      </Section>
    </>
  );
}
