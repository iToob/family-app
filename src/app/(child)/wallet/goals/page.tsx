import { getDb } from "@/db";
import { requireViewer } from "@/server/auth";
import { goals, wallet } from "@/server/queries";
import { closeGoalAction, createGoalAction, goalLockAction, moveSavingsAction } from "@/app/actions";
import { ActionForm, Field, Submit } from "@/components/forms";
import { Empty, PageHeader, Panel, Points, Progress, Section, Status } from "@/components/ui";
import { formatDate } from "@/lib/time";

export default async function Goals() {
  const v = await requireViewer();
  const db = getDb();
  const [list, w] = await Promise.all([goals(db, v.subjectId, true), wallet(db, v.subjectId)]);
  const active = list.filter((g) => g.status === "ACTIVE");
  const closed = list.filter((g) => g.status !== "ACTIVE");
  return (
    <>
      <PageHeader
        title="Savings goals"
        back="/wallet"
        subtitle={<>Set Points aside for something bigger. They stay yours; they're just not spendable until you move them back. <Points value={w.available} /> available.</>}
      />
      {active.length === 0 && <Empty>No goals yet.</Empty>}
      <ul className="space-y-3">
        {active.map((g) => (
          <li key={g.id} className="panel px-4 py-4">
            <div className="flex items-start gap-3">
              <span className="text-3xl" aria-hidden>{g.icon}</span>
              <div className="min-w-0 flex-1">
                <div className="flex justify-between gap-2">
                  <h3 className="font-semibold">{g.title}</h3>
                  {g.locked && <span className="text-xs text-hold">Locked</span>}
                </div>
                <div className="mt-1 text-sm text-muted tabular-nums">
                  {g.saved.toLocaleString("en-AU")} of {g.targetPoints.toLocaleString("en-AU")} Points ({g.pct}%)
                  {g.targetDate ? `, by ${formatDate(g.targetDate, v.timezone)}` : ""}
                </div>
                <div className="mt-2"><Progress pct={g.pct} /></div>
              </div>
            </div>
            {!v.readOnly && (
              <div className="mt-3 space-y-2">
                <ActionForm action={moveSavingsAction} className="flex gap-2" resetOnSuccess>
                  <input type="hidden" name="goalId" value={g.id} />
                  <input name="points" className="input" inputMode="numeric" placeholder="Points" aria-label="Points to move" required />
                  <Submit small name="direction" value="in">Add</Submit>
                  {!g.locked && <Submit small variant="secondary" name="direction" value="out">Take out</Submit>}
                </ActionForm>
                <div className="flex flex-wrap gap-2">
                  {!g.locked && (
                    <ActionForm action={goalLockAction} confirm="Lock this goal? Only a parent can unlock it.">
                      <input type="hidden" name="goalId" value={g.id} />
                      <input type="hidden" name="locked" value="yes" />
                      <Submit small variant="secondary">Lock it</Submit>
                    </ActionForm>
                  )}
                  {!g.locked && (
                    <ActionForm action={closeGoalAction} confirm="Close this goal? Its Points go back to available.">
                      <input type="hidden" name="goalId" value={g.id} />
                      <input type="hidden" name="status" value={g.saved >= g.targetPoints ? "COMPLETED" : "ARCHIVED"} />
                      <Submit small variant="secondary">{g.saved >= g.targetPoints ? "Reached it, release Points" : "Close goal"}</Submit>
                    </ActionForm>
                  )}
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>

      {!v.readOnly && (
        <Section title="New goal" className="mt-6">
          <Panel className="px-4 py-4">
            <ActionForm action={createGoalAction} className="space-y-3" resetOnSuccess>
              <div className="flex gap-2">
                <Field label="Icon" className="w-20">
                  <input name="icon" className="input text-center" defaultValue="🎯" maxLength={4} />
                </Field>
                <Field label="What are you saving for?" className="flex-1">
                  <input name="title" className="input" required placeholder="Headphones" />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Target (Points)">
                  <input name="targetPoints" className="input" inputMode="numeric" required />
                </Field>
                <Field label="By (optional)">
                  <input name="targetDate" type="date" className="input" />
                </Field>
              </div>
              <Submit>Create goal</Submit>
            </ActionForm>
          </Panel>
        </Section>
      )}

      {closed.length > 0 && (
        <Section title="Past goals">
          <ul className="panel rows">
            {closed.map((g) => (
              <li key={g.id} className="flex items-center justify-between px-4 py-3">
                <span>{g.icon} {g.title}</span>
                <Status value={g.status} />
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}
