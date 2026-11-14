import Link from "next/link";
import { formatAud, pointsToCents } from "@/lib/money";
import { formatDate } from "@/lib/time";
import type { pointsLedgerEntry } from "@/db/schema";
import { Coin, LEDGER_LABEL, Points, Row } from "./ui";

type Wallet = { available: number; held: number; saved: number; ledger: number; pendingEarnings: number };

/** The banknote balance card: the app's signature element. */
export function BalanceCard({ w, rate, name }: { w: Wallet; rate: number; name?: string }) {
  return (
    <div className="banknote px-6 pt-6 pb-5">
      <div className="relative">
        <div className="flex items-center justify-between text-sm text-[#cfe0da]">
          <span>{name ? `${name}'s Points` : "Available to spend"}</span>
          <Coin size={22} />
        </div>
        <div className="mt-2 font-display text-[3.2rem] leading-none font-semibold tracking-tight text-white tabular-nums">
          {w.available.toLocaleString("en-AU")}
        </div>
        <div className="mt-2 text-[#e9d7a8]">{formatAud(pointsToCents(w.available, rate))}</div>
        <dl className="mt-5 grid grid-cols-3 gap-2 border-t border-white/15 pt-3 text-sm">
          <div>
            <dt className="text-[#a9c4bc]">Saved</dt>
            <dd className="font-semibold text-white tabular-nums">{w.saved.toLocaleString("en-AU")}</dd>
          </div>
          <div>
            <dt className="text-[#a9c4bc]">On hold</dt>
            <dd className="font-semibold text-white tabular-nums">{w.held.toLocaleString("en-AU")}</dd>
          </div>
          <div>
            <dt className="text-[#a9c4bc]">Pending</dt>
            <dd className="font-semibold text-white tabular-nums">{w.pendingEarnings.toLocaleString("en-AU")}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

export function TxRow({ e, rate, tz, href }: { e: typeof pointsLedgerEntry.$inferSelect; rate: number; tz: string; href?: string }) {
  const cents = e.audCents ?? pointsToCents(Math.abs(e.points), e.centsPerPoint ?? rate);
  return (
    <Row href={href}>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{e.description}</div>
        <div className="text-xs text-muted">
          {LEDGER_LABEL[e.type]}, {formatDate(e.occurredAt, tz, true)}
        </div>
      </div>
      <div className="text-right">
        <Points value={e.points} signed tone="auto" className="font-semibold" size={14} />
        <div className="text-xs text-muted tabular-nums">{formatAud(cents)}</div>
      </div>
    </Row>
  );
}

export function ViewOnlyNote() {
  return (
    <p className="mb-4 rounded-xl bg-euc-100 px-4 py-3 text-sm text-euc">
      Your account is view-only for now. Mum or Dad will record jobs, purchases and cash-outs for you, and you'll see them here.
    </p>
  );
}

export function QuickAction({ href, label, icon }: { href: string; label: string; icon: React.ReactNode }) {
  return (
    <Link href={href} className="flex flex-col items-center gap-1.5 rounded-xl bg-surface py-3 text-sm font-medium ring-1 ring-line hover:bg-euc-100/50">
      <span className="text-euc">{icon}</span>
      {label}
    </Link>
  );
}
