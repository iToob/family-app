import { getDb } from "@/db";
import { requireViewer } from "@/server/auth";
import { memberDisputes } from "@/server/queries";
import { disputeAction } from "@/app/actions";
import { ActionForm, Field, Submit } from "@/components/forms";
import { Empty, PageHeader, Panel, Section, Status } from "@/components/ui";
import { formatDate } from "@/lib/time";

export default async function Disputes() {
  const v = await requireViewer();
  const list = await memberDisputes(getDb(), v.subjectId);
  return (
    <>
      <PageHeader title="Review requests" back="/more" subtitle="Think a decision, payment or charge is wrong? Ask for a review. Your parents will record what they decide." />
      {!v.previewing && (
        <Panel className="mb-6 px-4 py-4">
          <ActionForm action={disputeAction} className="space-y-3" resetOnSuccess>
            <Field label="About">
              <select name="subjectType" className="input">
                <option value="JOB">A rejected job</option>
                <option value="PAYMENT">An incorrect payment</option>
                <option value="CHARGE">An unexpected charge</option>
                <option value="PURCHASE">A purchase</option>
                <option value="OTHER">Something else</option>
              </select>
            </Field>
            <Field label="Which one? (optional)">
              <input name="subjectLabel" className="input" placeholder="e.g. Car wash on Saturday" />
            </Field>
            <Field label="Explain briefly">
              <textarea name="explanation" className="input" required />
            </Field>
            <Submit>Send for review</Submit>
          </ActionForm>
        </Panel>
      )}
      <Section title="History">
        {list.length === 0 ? (
          <Empty>No review requests.</Empty>
        ) : (
          <ul className="space-y-3">
            {list.map((d) => (
              <li key={d.id} className="panel px-4 py-3">
                <div className="flex justify-between gap-2">
                  <span className="font-medium">{d.subjectLabel ?? d.subjectType}</span>
                  <Status value={d.status} />
                </div>
                <p className="mt-1 text-sm">{d.explanation}</p>
                <p className="text-xs text-muted">{formatDate(d.createdAt, v.timezone)}</p>
                {d.outcome && <p className="mt-2 rounded-lg bg-paper px-3 py-2 text-sm">Outcome: {d.outcome}</p>}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
