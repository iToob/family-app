/**
 * Shared server-side primitives: actors, errors, audit log, notifications,
 * row locking and balance calculation. Everything here takes a transaction.
 */
import { and, eq, sql } from "drizzle-orm";
import type { DbOrTx, Tx } from "@/db";
import {
  auditLog,
  economySetting,
  household,
  householdMember,
  notification,
  pointsHold,
  pointsLedgerEntry,
} from "@/db/schema";

/** The authenticated person performing an action. Built only from a verified session. */
export type Actor = {
  householdId: string;
  memberId: string;
  role: "PARENT" | "CHILD";
  displayName: string;
};

/** An error whose message is safe to show to the user. */
export class DomainError extends Error {
  constructor(
    message: string,
    public code: string = "DOMAIN",
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export function requireRole(actor: Actor, role: "PARENT" | "CHILD") {
  if (actor.role !== role) throw new DomainError("You don't have permission to do that.", "FORBIDDEN");
}

export function assertPositiveInt(n: unknown, label: string, max = 1_000_000): number {
  if (typeof n !== "number" || !Number.isSafeInteger(n) || n <= 0 || n > max) {
    throw new DomainError(`${label} must be a whole number between 1 and ${max.toLocaleString("en-AU")}.`);
  }
  return n;
}

export async function audit(
  tx: DbOrTx,
  actor: Pick<Actor, "householdId" | "memberId"> | { householdId: string; memberId: null },
  action: string,
  entityType: string,
  entityId: string | null,
  details?: Record<string, unknown>,
) {
  const [row] = await tx
    .insert(auditLog)
    .values({
      householdId: actor.householdId,
      actorMemberId: actor.memberId,
      action,
      entityType,
      entityId,
      details: details ?? null,
    })
    .returning({ id: auditLog.id });
  return row.id;
}

export async function notify(
  tx: DbOrTx,
  householdId: string,
  memberId: string,
  title: string,
  body?: string,
  link?: string,
) {
  await tx.insert(notification).values({ householdId, memberId, title, body, link });
}

export async function notifyParents(
  tx: DbOrTx,
  householdId: string,
  title: string,
  body?: string,
  link?: string,
  exceptMemberId?: string,
) {
  const parents = await tx
    .select({ id: householdMember.id })
    .from(householdMember)
    .where(and(eq(householdMember.householdId, householdId), eq(householdMember.role, "PARENT")));
  for (const p of parents) {
    if (p.id !== exceptMemberId) await notify(tx, householdId, p.id, title, body, link);
  }
}

/**
 * Lock a member row for the rest of the transaction. Every operation that changes a
 * member's available Points takes this lock first, so concurrent requests for the
 * same member are serialised and can never overspend.
 */
export async function lockMember(tx: Tx, householdId: string, memberId: string) {
  const rows = await tx
    .select()
    .from(householdMember)
    .where(and(eq(householdMember.id, memberId), eq(householdMember.householdId, householdId)))
    .for("update");
  if (!rows[0]) throw new DomainError("Member not found.", "NOT_FOUND");
  return rows[0];
}

/** Load a member and verify it belongs to the household. */
export async function getMemberInHousehold(tx: DbOrTx, householdId: string, memberId: string) {
  const rows = await tx
    .select()
    .from(householdMember)
    .where(and(eq(householdMember.id, memberId), eq(householdMember.householdId, householdId)));
  if (!rows[0]) throw new DomainError("Member not found.", "NOT_FOUND");
  return rows[0];
}

export type Balances = {
  ledger: number;
  held: number;
  saved: number;
  available: number;
};

export async function getBalances(tx: DbOrTx, memberId: string): Promise<Balances> {
  const result = await tx.execute<{ ledger: string; held: string; saved: string }>(sql`
    SELECT
      (SELECT COALESCE(SUM(points), 0) FROM points_ledger_entry WHERE member_id = ${memberId}) AS ledger,
      (SELECT COALESCE(SUM(points), 0) FROM points_hold WHERE member_id = ${memberId} AND status = 'ACTIVE') AS held,
      (SELECT COALESCE(SUM(points), 0) FROM savings_allocation WHERE member_id = ${memberId}) AS saved
  `);
  const r = result.rows[0];
  const ledger = Number(r.ledger);
  const held = Number(r.held);
  const saved = Number(r.saved);
  return { ledger, held, saved, available: ledger - held - saved };
}

export async function getSettings(tx: DbOrTx, householdId: string) {
  const [s] = await tx.select().from(economySetting).where(eq(economySetting.householdId, householdId));
  if (!s) throw new DomainError("Economy settings missing.");
  return s;
}

export async function getHousehold(tx: DbOrTx, householdId: string) {
  const [h] = await tx.select().from(household).where(eq(household.id, householdId));
  if (!h) throw new DomainError("Household not found.", "NOT_FOUND");
  return h;
}

/** Children may only initiate requests when the household allows it. Parents always may. */
export async function assertMayRequest(tx: DbOrTx, actor: Actor) {
  if (actor.role === "PARENT") return;
  const s = await getSettings(tx, actor.householdId);
  if (!s.childRequestsEnabled) {
    throw new DomainError("Your account is view-only. Ask a parent to record this for you.", "VIEW_ONLY");
  }
}

export function insufficientMessage(needed: number, available: number) {
  const short = needed - available;
  return `You need ${short.toLocaleString("en-AU")} more Points. You have ${available.toLocaleString("en-AU")} available and this needs ${needed.toLocaleString("en-AU")}.`;
}

// ─────────────── Ledger and holds ───────────────

export type PostEntry = {
  householdId: string;
  memberId: string;
  type: (typeof pointsLedgerEntry.$inferInsert)["type"];
  points: number;
  description: string;
  idempotencyKey: string;
  sourceType?: string;
  sourceId?: string;
  approvedById?: string | null;
  createdById?: string | null;
  centsPerPoint?: number;
  audCents?: number;
  reversesEntryId?: string;
  category?: string | null;
  auditLogId?: string;
};

/**
 * Post an immutable ledger entry. The caller MUST hold the member lock. Fails if the
 * idempotency key has already been used, so a business event can only post once.
 */
export async function postEntry(tx: Tx, e: PostEntry) {
  if (!Number.isSafeInteger(e.points) || e.points === 0) throw new DomainError("Invalid Points amount.");
  const existing = await tx
    .select({ id: pointsLedgerEntry.id })
    .from(pointsLedgerEntry)
    .where(eq(pointsLedgerEntry.idempotencyKey, e.idempotencyKey));
  if (existing[0]) throw new DomainError("This transaction has already been posted.", "DUPLICATE");
  const [row] = await tx.insert(pointsLedgerEntry).values(e).returning();
  return row;
}

export async function createHold(
  tx: Tx,
  h: { householdId: string; memberId: string; points: number; sourceType: string; sourceId: string; description: string },
) {
  const [row] = await tx.insert(pointsHold).values(h).returning();
  return row;
}

async function resolveHold(tx: Tx, sourceType: string, sourceId: string, status: "RELEASED" | "CAPTURED") {
  const rows = await tx
    .update(pointsHold)
    .set({ status, resolvedAt: new Date() })
    .where(
      and(eq(pointsHold.sourceType, sourceType), eq(pointsHold.sourceId, sourceId), eq(pointsHold.status, "ACTIVE")),
    )
    .returning();
  return rows[0] ?? null;
}

export const releaseHold = (tx: Tx, sourceType: string, sourceId: string) =>
  resolveHold(tx, sourceType, sourceId, "RELEASED");
export const captureHold = (tx: Tx, sourceType: string, sourceId: string) =>
  resolveHold(tx, sourceType, sourceId, "CAPTURED");
