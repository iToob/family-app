import { redirect } from "next/navigation";
import { requireViewer } from "@/server/auth";
import { proposeAction } from "@/app/actions";
import { ActionForm, Field, PointsInput, Submit } from "@/components/forms";
import { PageHeader, Panel } from "@/components/ui";

export default async function Propose() {
  const v = await requireViewer();
  if (v.readOnly) redirect("/earn");
  return (
    <>
      <PageHeader title="Propose a job" back="/earn" subtitle="Spot something that needs doing? Pitch it. Your parents can accept, counter-offer or ask questions." />
      <Panel className="px-4 py-4">
        <ActionForm action={proposeAction} className="space-y-4">
          <Field label="Job title">
            <input name="title" className="input" required placeholder="Wash all the outside windows" />
          </Field>
          <Field label="What you'll do">
            <textarea name="whatToDo" className="input" required />
          </Field>
          <Field label="Who benefits?">
            <input name="beneficiaries" className="input" required placeholder="The whole family" />
          </Field>
          <Field label="Why is it valuable?">
            <textarea name="valueReason" className="input" required />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Estimated time (minutes)">
              <input name="estimatedMinutes" className="input" inputMode="numeric" />
            </Field>
            <Field label="Points you're asking for">
              <PointsInput name="proposedPoints" centsPerPoint={v.centsPerPoint} />
            </Field>
          </div>
          <Field label="Materials needed (optional)">
            <input name="materials" className="input" />
          </Field>
          <Field label="Any costs (optional)">
            <input name="costs" className="input" placeholder="e.g. $8 for window cleaner" />
          </Field>
          <Submit className="w-full">Send proposal</Submit>
        </ActionForm>
      </Panel>
    </>
  );
}
