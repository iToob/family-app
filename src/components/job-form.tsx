import type { earningOpportunity } from "@/db/schema";
import { DependsOn, Field, MilestoneEditor, Submit } from "./forms";

type Opp = typeof earningOpportunity.$inferSelect;
type Cat = { id: string; name: string; icon: string };

/** Shared fields for creating and editing a job. Rendered inside an ActionForm. */
export function JobFields({ cats, opp, guidelines }: { cats: Cat[]; opp?: Opp; guidelines?: string }) {
  const editing = !!opp;
  const isProject = opp?.kind === "PROJECT";
  return (
    <div className="space-y-4">
      {editing && <input type="hidden" name="id" value={opp.id} />}
      {editing ? (
        <input type="hidden" name="kind" value={opp.kind} />
      ) : (
        <Field label="Type">
          <select name="kind" className="input">
            <option value="JOB">Job (single task, one reward)</option>
            <option value="PROJECT">Project (several milestones, paid separately)</option>
          </select>
        </Field>
      )}
      <Field label="Title">
        <input name="title" className="input" required defaultValue={opp?.title} placeholder="Wash and vacuum the car" />
      </Field>
      <Field label="Description">
        <textarea name="description" className="input" defaultValue={opp?.description} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Category">
          <select name="categoryId" className="input" defaultValue={opp?.categoryId ?? ""}>
            <option value="">None</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
          </select>
        </Field>
        {!isProject && (
          <DependsOn field="kind" values={["JOB"]}>
            <Field label="Reward (Points)" hint={guidelines}>
              <input name="rewardPoints" className="input" inputMode="numeric" defaultValue={opp?.rewardPoints} />
            </Field>
          </DependsOn>
        )}
        <Field label="Estimated minutes">
          <input name="estimatedMinutes" className="input" inputMode="numeric" defaultValue={opp?.estimatedMinutes ?? ""} />
        </Field>
      </div>
      {!editing && (
        <DependsOn field="kind" values={["PROJECT"]}>
          <Field label="Milestones" hint="Each milestone is claimed, approved and paid on its own.">
            <MilestoneEditor />
          </Field>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="collaborative" className="h-5 w-5 accent-[#0e3b36]" />
            Different children can do different milestones
          </label>
        </DependsOn>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Difficulty">
          <select name="difficulty" className="input" defaultValue={opp?.difficulty ?? "EASY"}>
            <option value="EASY">Easy</option>
            <option value="MEDIUM">Medium</option>
            <option value="HARD">Hard</option>
          </select>
        </Field>
        <Field label="Suitable for" hint="Age or skill notes">
          <input name="requirements" className="input" defaultValue={opp?.requirements ?? ""} placeholder="Licence holders only" />
        </Field>
        <Field label="Where">
          <input name="location" className="input" defaultValue={opp?.location ?? ""} />
        </Field>
      </div>
      <Field label="Instructions and quality expectations">
        <textarea name="instructions" className="input" defaultValue={opp?.instructions ?? ""} placeholder="What 'done properly' looks like" />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Equipment">
          <input name="equipment" className="input" defaultValue={opp?.equipment ?? ""} />
        </Field>
        <Field label="Safety notes">
          <input name="safetyNotes" className="input" defaultValue={opp?.safetyNotes ?? ""} />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Due date (optional)">
          <input name="dueAt" type="date" className="input" defaultValue={opp?.dueAt ? opp.dueAt.toISOString().slice(0, 10) : ""} />
        </Field>
        {!isProject && (
          <Field label="Spots" hint="How many kids can each do it (each paid in full)">
            <input name="positions" className="input" inputMode="numeric" defaultValue={opp?.positions ?? 1} />
          </Field>
        )}
        <Field label="Approval">
          <select name="requiresApproval" className="input" defaultValue={opp && !opp.requiresApproval ? "no" : "yes"}>
            <option value="yes">A parent approves</option>
            <option value="no">Pays automatically on submission</option>
          </select>
        </Field>
      </div>
      {!editing && (
        <DependsOn field="kind" values={["JOB"]}>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Repeats">
              <select name="recurrence" className="input" defaultValue="NONE">
                <option value="NONE">Doesn't repeat</option>
                <option value="DAILY">Daily</option>
                <option value="WEEKLY">Weekly</option>
                <option value="FORTNIGHTLY">Fortnightly</option>
                <option value="MONTHLY">Monthly</option>
                <option value="CUSTOM">Every N days</option>
              </select>
            </Field>
            <Field label="Starting" hint="First period begins on this date">
              <input name="recurrenceAnchor" type="date" className="input" />
            </Field>
            <DependsOn field="recurrence" values={["CUSTOM"]}>
              <Field label="Every how many days">
                <input name="recurrenceEveryDays" className="input" inputMode="numeric" />
              </Field>
            </DependsOn>
          </div>
        </DependsOn>
      )}
      {editing && opp.recurrence !== "NONE" && (
        <p className="text-sm text-muted">Repeats {opp.recurrence.toLowerCase()}. Reward changes apply to new and unclaimed occurrences only.</p>
      )}
      <Submit>{editing ? "Save changes" : "Publish"}</Submit>
    </div>
  );
}
