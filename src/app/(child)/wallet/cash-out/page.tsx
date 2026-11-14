import { getDb } from "@/db";
import { requireViewer } from "@/server/auth";
import { getSettings } from "@/server/core";
import { memberCashOuts, wallet } from "@/server/queries";
import { cancelCashOutAction, cashOutAction } from "@/app/actions";
import { ActionForm, Field, IdempotencyKey, PointsInput, Submit } from "@/components/forms";
import { Empty, PageHeader, Panel, Points, Row, Rows, Section, Status } from "@/components/ui";
import { ViewOnlyNote } from "@/components/money-bits";
import { describeRate, formatAud } from "@/lib/money";
import { formatDate } from "@/lib/time";

export default async function CashOut() {
  const v = await requireViewer();
  const db = getDb();
  const [w, s, history] = await Promise.all([wallet(db, v.subjectId), getSettings(db, v.householdId), memberCashOuts(db, v.subjectId)]);
  return (
    <>
      <PageHeader title="Convert to cash" back="/wallet" subtitle={`${describeRate(s.centsPerPoint)}. ${s.payoutSchedule}`} />
      {v.readOnly && !v.previewing && <ViewOnlyNote />}
      {!v.readOnly && (
        <Panel className="mb-6 px-4 py-4">
          <ActionForm action={cashOutAction} className="space-y-4" resetOnSuccess>
            <IdempotencyKey />
            <Field label="Points to convert" hint={`Minimum ${s.minCashOutPoints.toLocaleString("en-AU")}${s.maxCashOutPoints ? `, maximum ${s.maxCashOutPoints.toLocaleString("en-AU")}` : ""}. You have ${w.available.toLocaleString("en-AU")} available.`}>
              <PointsInput name="points" centsPerPoint={s.centsPerPoint} max={w.available} />
            </Field>
            <Field label="How would you like it?">
              <select name="method" className="input">
                {s.cashOutMethods.map((m) => <option key={m}>{m}</option>)}
              </select>
            </Field>
            <p className="text-sm text-muted">The Points are set aside now and leave your balance when a parent records the payment.</p>
            <Submit className="w-full">Request cash</Submit>
          </ActionForm>
        </Panel>
      )}
      <Section title="Cash-out history">
        {history.length === 0 ? (
          <Empty>No cash-outs yet.</Empty>
        ) : (
          <Rows>
            {history.map((r) => (
              <Row key={r.id}>
                <div className="flex-1">
                  <div className="font-medium">{formatAud(r.audCents)}</div>
                  <div className="text-xs text-muted">
                    Requested {formatDate(r.requestedAt, v.timezone)}
                    {r.paidAt ? `, paid ${formatDate(r.paidAt, v.timezone)} by ${r.method}` : ""}
                    {r.rejectedReason ? `. ${r.rejectedReason}` : ""}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Points value={r.points} size={14} />
                  <Status value={r.status} />
                  {!v.readOnly && r.status === "REQUESTED" && (
                    <ActionForm action={cancelCashOutAction}>
                      <input type="hidden" name="id" value={r.id} />
                      <Submit small variant="secondary">Cancel</Submit>
                    </ActionForm>
                  )}
                </div>
              </Row>
            ))}
          </Rows>
        )}
      </Section>
    </>
  );
}
