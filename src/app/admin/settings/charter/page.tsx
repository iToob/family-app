import { getDb } from "@/db";
import { requireParentSession } from "@/server/auth";
import { acknowledgements, charterHistory } from "@/server/queries";
import { latestCharter } from "@/server/household";
import { publishCharterAction } from "../../../actions";
import { ActionForm, Field, Submit } from "@/components/forms";
import { CharterText, PageHeader, Panel, Section } from "@/components/ui";
import { describeRate } from "@/lib/money";
import { formatDate } from "@/lib/time";

export default async function CharterAdmin() {
  const s = await requireParentSession();
  const db = getDb();
  const hid = s.actor.householdId;
  const [c, history, acks] = await Promise.all([latestCharter(db, hid), charterHistory(db, hid), acknowledgements(db, hid)]);
  return (
    <>
      <PageHeader title="Family charter" back="/admin/settings" subtitle={c ? `Version ${c.version}, published ${formatDate(c.publishedAt, s.timezone)}` : undefined} />
      <Section title="Edit and publish a new version">
        <Panel className="px-4 py-4">
          <ActionForm action={publishCharterAction} className="space-y-3">
            <Field label="Title"><input name="title" className="input" defaultValue={c?.title ?? "Our Family Economy Charter"} required /></Field>
            <Field label="Text" hint="Use # for headings and - for bullet points. {{rate}} shows the current exchange rate.">
              <textarea name="body" className="input min-h-[24rem] font-mono text-sm" defaultValue={c?.body} required />
            </Field>
            <Field label="What changed (shown to the kids)"><input name="changeSummary" className="input" /></Field>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="significant" defaultChecked className="h-5 w-5 accent-[#0e3b36]" />
              Significant change: ask everyone to acknowledge again
            </label>
            <Submit>Publish new version</Submit>
          </ActionForm>
        </Panel>
      </Section>
      {c && (
        <Section title="Current version, as the kids see it">
          <Panel className="px-5 py-3"><CharterText body={c.body} rate={describeRate(s.centsPerPoint)} /></Panel>
        </Section>
      )}
      <Section title="Acknowledgements">
        <ul className="panel rows text-sm">
          {acks.length === 0 && <li className="px-4 py-3 text-muted">None yet.</li>}
          {acks.map(({ ack, version, member }) => (
            <li key={ack.id} className="flex justify-between gap-3 px-4 py-2.5">
              <span>{member.displayName}: v{version}, {ack.participationChoice === "ACTIVE" ? "joined" : "not participating"}</span>
              <span className="text-muted">{formatDate(ack.acknowledgedAt, s.timezone)}</span>
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Previous versions">
        <ul className="panel rows text-sm">
          {history.map((h) => (
            <li key={h.id} className="px-4 py-2.5">
              <details>
                <summary className="flex justify-between gap-3"><span>v{h.version}: {h.changeSummary ?? h.title}</span><span className="text-muted">{formatDate(h.publishedAt, s.timezone)}</span></summary>
                <div className="mt-2"><CharterText body={h.body} rate={describeRate(s.centsPerPoint)} /></div>
              </details>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}
