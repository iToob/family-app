import { awardAction, directSpendAction, purchaseAction, recordJobAction } from "@/app/actions";
import { ActionForm, Field, IdempotencyKey, PointsInput, Submit } from "./forms";

type Kid = { id: string; displayName: string };
type Occ = { occ: { id: string; title: string; rewardPoints: number } };
type Item = { item: { id: string; name: string; pricePoints: number } };

function KidSelect({ kids, defaultId }: { kids: Kid[]; defaultId?: string }) {
  if (kids.length === 1 || defaultId) {
    const k = kids.find((x) => x.id === defaultId) ?? kids[0];
    return <input type="hidden" name="memberId" value={k.id} />;
  }
  return (
    <Field label="Who">
      <select name="memberId" className="input" required defaultValue="">
        <option value="" disabled>Choose…</option>
        {kids.map((k) => <option key={k.id} value={k.id}>{k.displayName}</option>)}
      </select>
    </Field>
  );
}

/** The parent's everyday tools: add Points, record a spend, record a job. */
export function QuickRecord({ kids, occurrences, items, rate, memberId }: { kids: Kid[]; occurrences: Occ[]; items: Item[]; rate: number; memberId?: string }) {
  if (!kids.length) return null;
  const card = "panel overflow-hidden";
  const sum = "flex items-center justify-between px-4 py-3 font-semibold";
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <details className={card} name="quick">
        <summary className={sum}>
          <span className="text-credit">+ Add Points</span>
          <span className="text-muted" aria-hidden>▾</span>
        </summary>
        <ActionForm action={awardAction} className="space-y-3 border-t border-line px-4 py-4" resetOnSuccess>
          <IdempotencyKey />
          <KidSelect kids={kids} defaultId={memberId} />
          <Field label="Points"><PointsInput name="points" centsPerPoint={rate} /></Field>
          <Field label="Type">
            <select name="kind" className="input">
              <option value="BONUS">Bonus (initiative, great work)</option>
              <option value="MANUAL_AWARD">Payment for agreed work</option>
              <option value="OPENING_BALANCE">Opening balance (once)</option>
            </select>
          </Field>
          <Field label="Reason" hint="Shown to your child and kept in the record.">
            <input name="reason" className="input" required placeholder="Helped Grandma move furniture" />
          </Field>
          <Submit className="w-full">Add Points</Submit>
        </ActionForm>
      </details>

      <details className={card} name="quick">
        <summary className={sum}>
          <span>− Record a spend</span>
          <span className="text-muted" aria-hidden>▾</span>
        </summary>
        <div className="space-y-5 border-t border-line px-4 py-4">
          {items.length > 0 && (
            <ActionForm action={purchaseAction} className="space-y-3" resetOnSuccess>
              <IdempotencyKey />
              <KidSelect kids={kids} defaultId={memberId} />
              <Field label="From the marketplace">
                <select name="itemId" className="input" required defaultValue="">
                  <option value="" disabled>Choose an item…</option>
                  {items.map(({ item }) => (
                    <option key={item.id} value={item.id}>{item.name} ({item.pricePoints.toLocaleString("en-AU")})</option>
                  ))}
                </select>
              </Field>
              <Submit className="w-full">Record purchase</Submit>
            </ActionForm>
          )}
          <ActionForm action={directSpendAction} className="space-y-3" resetOnSuccess>
            <IdempotencyKey />
            {items.length > 0 && <p className="text-sm font-medium">Or something else</p>}
            <KidSelect kids={kids} defaultId={memberId} />
            <Field label="Points"><PointsInput name="points" centsPerPoint={rate} /></Field>
            <Field label="What for">
              <input name="description" className="input" required placeholder="Movie ticket" />
            </Field>
            <Submit className="w-full" variant="secondary">Record spend</Submit>
          </ActionForm>
        </div>
      </details>

      <details className={card} name="quick">
        <summary className={sum}>
          <span>✓ Record a job</span>
          <span className="text-muted" aria-hidden>▾</span>
        </summary>
        <div className="border-t border-line px-4 py-4">
          {occurrences.length === 0 ? (
            <p className="text-sm text-muted">No open jobs. Add jobs on the Jobs tab, or use Add Points for one-off work.</p>
          ) : (
            <ActionForm action={recordJobAction} className="space-y-3" resetOnSuccess>
              <KidSelect kids={kids} defaultId={memberId} />
              <Field label="Job">
                <select name="occurrenceId" className="input" required defaultValue="">
                  <option value="" disabled>Choose a job…</option>
                  {occurrences.map(({ occ }) => (
                    <option key={occ.id} value={occ.id}>{occ.title} ({occ.rewardPoints.toLocaleString("en-AU")})</option>
                  ))}
                </select>
              </Field>
              <Field label="Note (optional)"><input name="note" className="input" /></Field>
              <Submit className="w-full">Record and pay</Submit>
            </ActionForm>
          )}
        </div>
      </details>
    </div>
  );
}
