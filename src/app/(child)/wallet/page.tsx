import Link from "next/link";
import { getDb } from "@/db";
import { requireViewer } from "@/server/auth";
import { activeHolds, transactions, wallet } from "@/server/queries";
import { BalanceCard, TxRow } from "@/components/money-bits";
import { Aud, Empty, LEDGER_LABEL, Points, Row, Rows, Section } from "@/components/ui";

export default async function Wallet({ searchParams }: { searchParams: Promise<{ q?: string; type?: string }> }) {
  const sp = await searchParams;
  const v = await requireViewer();
  const db = getDb();
  const [w, holds, txs] = await Promise.all([
    wallet(db, v.subjectId),
    activeHolds(db, v.subjectId),
    transactions(db, v.subjectId, { q: sp.q, type: sp.type, limit: 300 }),
  ]);
  return (
    <>
      <h1 className="mb-5 text-[1.65rem] font-semibold">Wallet</h1>
      <BalanceCard w={w} rate={v.centsPerPoint} />
      {!v.readOnly && (
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Link href="/wallet/cash-out" className="btn btn-primary">Convert to cash</Link>
          <Link href="/wallet/goals" className="btn btn-secondary">Savings goals</Link>
        </div>
      )}

      <Section title="Breakdown" className="mt-6">
        <Rows>
          <Row><span className="flex-1">Total balance</span><Points value={w.ledger} className="font-semibold" /></Row>
          <Row><span className="flex-1 text-muted">Held for pending requests</span><Points value={-w.held} /></Row>
          <Row><span className="flex-1 text-muted">Set aside in savings</span><Points value={-w.saved} /></Row>
          <Row className="bg-paper/60"><span className="flex-1 font-medium">Available to spend</span><Points value={w.available} className="font-semibold" /></Row>
        </Rows>
        <dl className="mt-3 grid grid-cols-3 gap-2 text-center text-sm">
          {[
            ["Earned all-time", w.lifetimeEarned],
            ["Spent all-time", w.lifetimeSpent],
            ["Cashed out", w.lifetimeConverted],
          ].map(([k, n]) => (
            <div key={k as string} className="panel px-2 py-2.5">
              <dt className="text-xs text-muted">{k}</dt>
              <dd className="font-semibold tabular-nums">{(n as number).toLocaleString("en-AU")}</dd>
              <dd className="text-xs text-muted"><Aud points={n as number} rate={v.centsPerPoint} /></dd>
            </div>
          ))}
        </dl>
      </Section>

      {holds.length > 0 && (
        <Section title="On hold">
          <Rows>
            {holds.map((h) => (
              <Row key={h.id}>
                <span className="flex-1 text-sm">{h.description}</span>
                <Points value={h.points} size={14} />
              </Row>
            ))}
          </Rows>
        </Section>
      )}

      <Section title="History">
        <form className="mb-3 flex gap-2" role="search">
          <input name="q" defaultValue={sp.q} placeholder="Search" className="input" aria-label="Search transactions" />
          <select name="type" defaultValue={sp.type ?? ""} className="input w-40" aria-label="Type">
            <option value="">All types</option>
            {Object.entries(LEDGER_LABEL).map(([k, l]) => (
              <option key={k} value={k}>{l}</option>
            ))}
          </select>
          <button className="btn btn-secondary">Go</button>
        </form>
        {txs.length ? (
          <Rows>
            {txs.map((e) => (
              <TxRow key={e.id} e={e} rate={v.centsPerPoint} tz={v.timezone} />
            ))}
          </Rows>
        ) : (
          <Empty>No matching transactions.</Empty>
        )}
      </Section>
    </>
  );
}
