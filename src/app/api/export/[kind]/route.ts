import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { cashOutRequest, earningOpportunity, householdMember, jobClaim, jobOccurrence, pointsLedgerEntry, purchase } from "@/db/schema";
import { getSession } from "@/server/auth";
import { audit } from "@/server/core";
import { wallet } from "@/server/queries";

export const dynamic = "force-dynamic";

function csv(rows: (string | number | null | undefined | Date)[][]) {
  const cell = (v: unknown) => {
    if (v == null) return "";
    const s = v instanceof Date ? v.toISOString() : String(v);
    // Neutralise spreadsheet formula injection.
    const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

const cents = (c: number | null | undefined) => (c == null ? "" : (c / 100).toFixed(2));

export async function GET(_req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const s = await getSession();
  if (!s || s.actor.role !== "PARENT") return new Response("Forbidden", { status: 403 });
  const { kind } = await params;
  const db = getDb();
  const hid = s.actor.householdId;
  const rate = s.centsPerPoint;
  let rows: (string | number | null | undefined | Date)[][] = [];

  if (kind === "ledger" || kind === "earnings") {
    const data = await db
      .select({ e: pointsLedgerEntry, name: householdMember.displayName })
      .from(pointsLedgerEntry)
      .innerJoin(householdMember, eq(pointsLedgerEntry.memberId, householdMember.id))
      .where(eq(pointsLedgerEntry.householdId, hid))
      .orderBy(pointsLedgerEntry.occurredAt);
    const filtered = kind === "earnings" ? data.filter((d) => ["JOB_EARNING", "BONUS", "MANUAL_AWARD", "OPENING_BALANCE"].includes(d.e.type)) : data;
    rows = [["id", "occurred_at_utc", "participant", "type", "description", "points", "aud", "rate_cents_per_point", "category", "source_type", "source_id", "reverses_entry_id", "approved_by"]];
    for (const { e, name } of filtered) {
      rows.push([e.id, e.occurredAt, name, e.type, e.description, e.points, cents(e.audCents ?? e.points * (e.centsPerPoint ?? rate)), e.centsPerPoint ?? rate, e.category, e.sourceType, e.sourceId, e.reversesEntryId, e.approvedById]);
    }
  } else if (kind === "purchases") {
    const data = await db
      .select({ p: purchase, name: householdMember.displayName })
      .from(purchase)
      .innerJoin(householdMember, eq(purchase.memberId, householdMember.id))
      .where(eq(purchase.householdId, hid))
      .orderBy(purchase.requestedAt);
    rows = [["receipt", "requested_at_utc", "participant", "item", "points", "aud", "status", "decided_at_utc", "fulfilled_at_utc", "refunded_at_utc", "reason"]];
    for (const { p, name } of data) rows.push([p.receiptNumber, p.requestedAt, name, p.itemName, p.pricePoints, cents(p.pricePoints * rate), p.status, p.decidedAt, p.fulfilledAt, p.refundedAt, p.decisionReason ?? p.refundReason]);
  } else if (kind === "payouts") {
    const data = await db
      .select({ r: cashOutRequest, name: householdMember.displayName })
      .from(cashOutRequest)
      .innerJoin(householdMember, eq(cashOutRequest.memberId, householdMember.id))
      .where(eq(cashOutRequest.householdId, hid))
      .orderBy(cashOutRequest.requestedAt);
    rows = [["id", "participant", "points", "aud", "rate_cents_per_point", "status", "requested_at_utc", "approved_at_utc", "paid_at_utc", "method", "reference"]];
    for (const { r, name } of data) rows.push([r.id, name, r.points, cents(r.audCents), r.centsPerPoint, r.status, r.requestedAt, r.approvedAt, r.paidAt, r.method, r.reference]);
  } else if (kind === "balances") {
    const kids = await db.select().from(householdMember).where(and(eq(householdMember.householdId, hid), eq(householdMember.role, "CHILD")));
    rows = [["participant", "status", "ledger_balance", "held", "saved", "available", "available_aud", "lifetime_earned", "lifetime_spent", "lifetime_converted"]];
    for (const k of kids) {
      const w = await wallet(db, k.id);
      rows.push([k.displayName, k.participationStatus, w.ledger, w.held, w.saved, w.available, cents(w.available * rate), w.lifetimeEarned, w.lifetimeSpent, w.lifetimeConverted]);
    }
  } else if (kind === "jobs") {
    const data = await db
      .select({ c: jobClaim, o: jobOccurrence, name: householdMember.displayName })
      .from(jobClaim)
      .innerJoin(jobOccurrence, eq(jobClaim.occurrenceId, jobOccurrence.id))
      .innerJoin(earningOpportunity, eq(jobOccurrence.opportunityId, earningOpportunity.id))
      .innerJoin(householdMember, eq(jobClaim.memberId, householdMember.id))
      .where(eq(earningOpportunity.householdId, hid))
      .orderBy(jobClaim.claimedAt);
    rows = [["claim_id", "job", "period", "participant", "reward_points", "status", "claimed_at_utc", "updated_at_utc"]];
    for (const { c, o, name } of data) rows.push([c.id, o.title, o.periodKey, name, o.rewardPoints, c.status, c.claimedAt, c.updatedAt]);
  } else {
    return new Response("Unknown export", { status: 404 });
  }
  await audit(db, s.actor, "export.csv", "Household", hid, { kind });
  const date = new Date().toISOString().slice(0, 10);
  return new Response("﻿" + csv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="family-economy-${kind}-${date}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
