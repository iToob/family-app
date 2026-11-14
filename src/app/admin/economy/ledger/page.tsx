import { getDb } from "@/db";
import { requireParentSession } from "@/server/auth";
import { householdLedger } from "@/server/queries";
import { LEDGER_LABEL, PageHeader, Points } from "@/components/ui";
import { formatAud, pointsToCents } from "@/lib/money";
import { formatDate } from "@/lib/time";

export default async function Ledger() {
  const s = await requireParentSession();
  const rows = await householdLedger(getDb(), s.actor.householdId, 1000);
  return (
    <>
      <PageHeader title="Ledger" back="/admin/economy" subtitle="Every posted transaction, newest first. Entries are permanent; errors are fixed with visible corrections." />
      <div className="panel overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="text-muted">
            <tr className="border-b border-line">
              <th className="px-3 py-2 font-medium">When</th>
              <th className="px-3 py-2 font-medium">Who</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">Description</th>
              <th className="px-3 py-2 text-right font-medium">Points</th>
              <th className="px-3 py-2 text-right font-medium">AUD</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ e, memberName }) => (
              <tr key={e.id} className="border-b border-line last:border-0">
                <td className="px-3 py-2 whitespace-nowrap text-muted">{formatDate(e.occurredAt, s.timezone, true)}</td>
                <td className="px-3 py-2">{memberName}</td>
                <td className="px-3 py-2">{LEDGER_LABEL[e.type]}</td>
                <td className="px-3 py-2">{e.description}</td>
                <td className="px-3 py-2 text-right"><Points value={e.points} signed tone="auto" size={12} /></td>
                <td className="px-3 py-2 text-right tabular-nums text-muted">{formatAud(e.audCents ?? pointsToCents(Math.abs(e.points), e.centsPerPoint ?? s.centsPerPoint))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
