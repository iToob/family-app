import { getDb } from "@/db";
import { requireViewer } from "@/server/auth";
import { memberProposals } from "@/server/queries";
import { childProposalAction } from "@/app/actions";
import { ActionForm, Field, Submit } from "@/components/forms";
import { Empty, PageHeader, Panel, Points, Status } from "@/components/ui";

export default async function Proposals() {
  const v = await requireViewer();
  const list = await memberProposals(getDb(), v.subjectId);
  return (
    <>
      <PageHeader title="Your proposals" back="/earn" />
      {list.length === 0 && <Empty>You haven't proposed any jobs yet.</Empty>}
      <ul className="space-y-3">
        {list.map((p) => (
          <li key={p.id} className="panel px-4 py-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold">{p.title}</h3>
                <Status value={p.status} />
              </div>
              <Points value={p.counterPoints ?? p.proposedPoints} className="font-semibold" />
            </div>
            {p.parentResponse && <p className="mt-2 rounded-lg bg-paper px-3 py-2 text-sm">Parent: {p.parentResponse}</p>}
            {!v.readOnly && p.status === "COUNTERED" && (
              <div className="mt-3">
                <p className="text-sm">
                  You asked for {p.proposedPoints.toLocaleString("en-AU")}. Offer: <strong>{p.counterPoints?.toLocaleString("en-AU")} Points</strong>.
                </p>
                <div className="mt-2 flex gap-2">
                  <ActionForm action={childProposalAction}>
                    <input type="hidden" name="id" value={p.id} />
                    <input type="hidden" name="action" value="ACCEPT" />
                    <Submit small>Accept offer</Submit>
                  </ActionForm>
                  <ActionForm action={childProposalAction}>
                    <input type="hidden" name="id" value={p.id} />
                    <input type="hidden" name="action" value="DECLINE_COUNTER" />
                    <Submit small variant="secondary">No thanks</Submit>
                  </ActionForm>
                </div>
              </div>
            )}
            {!v.readOnly && (p.status === "INFO_REQUESTED" || p.status === "COUNTERED") && (
              <details className="mt-3">
                <summary className="text-sm font-medium text-euc">Update and resubmit</summary>
                <ActionForm action={childProposalAction} className="mt-2 space-y-3">
                  <input type="hidden" name="id" value={p.id} />
                  <input type="hidden" name="action" value="RESUBMIT" />
                  <Field label="What you'll do">
                    <textarea name="whatToDo" className="input" defaultValue={p.whatToDo} />
                  </Field>
                  <Field label="Points">
                    <input name="proposedPoints" className="input w-32" inputMode="numeric" defaultValue={p.proposedPoints} />
                  </Field>
                  <Field label="Message">
                    <input name="message" className="input" />
                  </Field>
                  <Submit small>Resubmit</Submit>
                </ActionForm>
              </details>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
