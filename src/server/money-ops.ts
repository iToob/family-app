/**
 * Cash conversion, savings goals, parental awards, direct spends and corrections.
 */
import { and, eq, sql } from "drizzle-orm";
import type { DB, Tx } from "@/db";
import {
  adjustmentRequest,
  cashOutRequest,
  pointsLedgerEntry,
  savingsAllocation,
  savingsGoal,
} from "@/db/schema";
import { pointsToCents } from "@/lib/money";
import {
  type Actor,
  DomainError,
  assertMayRequest,
  assertPositiveInt,
  audit,
  captureHold,
  createHold,
  getBalances,
  getMemberInHousehold,
  getSettings,
  insufficientMessage,
  lockMember,
  notify,
  notifyParents,
  postEntry,
  releaseHold,
  requireRole,
} from "./core";
import { formatAud } from "@/lib/money";

// ─────────────── Cash conversion ───────────────

export async function quoteCashOut(tx: DB | Tx, householdId: string, points: number) {
  const s = await getSettings(tx, householdId);
  return { points, centsPerPoint: s.centsPerPoint, audCents: pointsToCents(points, s.centsPerPoint) };
}

export async function requestCashOut(
  db: DB,
  actor: Actor,
  points: number,
  idempotencyKey: string,
  preferredMethod?: string,
) {
  requireRole(actor, "CHILD");
  assertPositiveInt(points, "Points", 10_000_000);
  if (!idempotencyKey || idempotencyKey.length < 8) throw new DomainError("Missing request key. Please reload and try again.");
  return db.transaction(async (tx) => {
    await assertMayRequest(tx, actor);
    await lockMember(tx, actor.householdId, actor.memberId);
    const key = `${actor.memberId}:${idempotencyKey}`;
    const [dupe] = await tx.select().from(cashOutRequest).where(eq(cashOutRequest.idempotencyKey, key));
    if (dupe) return dupe;
    const s = await getSettings(tx, actor.householdId);
    if (points < s.minCashOutPoints) {
      throw new DomainError(`The minimum cash-out is ${s.minCashOutPoints.toLocaleString("en-AU")} Points.`);
    }
    if (s.maxCashOutPoints && points > s.maxCashOutPoints) {
      throw new DomainError(`The maximum per cash-out is ${s.maxCashOutPoints.toLocaleString("en-AU")} Points.`);
    }
    const bal = await getBalances(tx, actor.memberId);
    if (bal.available < points) throw new DomainError(insufficientMessage(points, bal.available), "INSUFFICIENT");
    const audCents = pointsToCents(points, s.centsPerPoint);
    const [req] = await tx
      .insert(cashOutRequest)
      .values({
        householdId: actor.householdId,
        memberId: actor.memberId,
        points,
        centsPerPoint: s.centsPerPoint,
        audCents,
        idempotencyKey: key,
        preferredMethod: preferredMethod || null,
      })
      .returning();
    await createHold(tx, {
      householdId: actor.householdId,
      memberId: actor.memberId,
      points,
      sourceType: "CASH_OUT",
      sourceId: req.id,
      description: `Cash-out request (${formatAud(audCents)})`,
    });
    await audit(tx, actor, "cashout.request", "CashOutRequest", req.id, { points, audCents, centsPerPoint: s.centsPerPoint });
    await notifyParents(tx, actor.householdId, `${actor.displayName} requested ${formatAud(audCents)}`, `${points.toLocaleString("en-AU")} Points cash-out.`, "/admin/approvals");
    return req;
  });
}

async function loadCashOutForUpdate(tx: Tx, householdId: string, id: string) {
  const [r] = await tx
    .select()
    .from(cashOutRequest)
    .where(and(eq(cashOutRequest.id, id), eq(cashOutRequest.householdId, householdId)))
    .for("update");
  if (!r) throw new DomainError("Cash-out request not found.", "NOT_FOUND");
  return r;
}

export async function approveCashOut(db: DB, actor: Actor, id: string) {
  requireRole(actor, "PARENT");
  return db.transaction(async (tx) => {
    const r = await loadCashOutForUpdate(tx, actor.householdId, id);
    if (r.status !== "REQUESTED") throw new DomainError("This request has already been decided.", "STALE");
    await tx.update(cashOutRequest).set({ status: "APPROVED", approvedAt: new Date(), approvedById: actor.memberId }).where(eq(cashOutRequest.id, id));
    await audit(tx, actor, "cashout.approve", "CashOutRequest", id);
    await notify(tx, actor.householdId, r.memberId, `Cash-out approved: ${formatAud(r.audCents)}`, "A parent will pay you soon.", "/wallet/cash-out");
  });
}

/**
 * Record that cash was actually paid. This is when the Points are permanently debited.
 * The row lock, status check and ledger idempotency key make double payment impossible.
 */
export async function markCashOutPaid(
  db: DB,
  actor: Actor,
  id: string,
  input: { method: string; reference?: string | null; paidAt?: Date | null },
) {
  requireRole(actor, "PARENT");
  if (!input.method?.trim()) throw new DomainError("Choose a payment method.");
  return db.transaction(async (tx) => {
    const r = await loadCashOutForUpdate(tx, actor.householdId, id);
    if (r.status === "PAID") throw new DomainError("This cash-out has already been paid.", "STALE");
    if (!["REQUESTED", "APPROVED"].includes(r.status)) throw new DomainError("This request is closed.", "STALE");
    await lockMember(tx, actor.householdId, r.memberId);
    const hold = await captureHold(tx, "CASH_OUT", r.id);
    if (!hold) throw new DomainError("The reserved Points for this request are missing.");
    const paidAt = input.paidAt ?? new Date();
    const auditId = await audit(tx, actor, "cashout.paid", "CashOutRequest", id, {
      points: r.points,
      audCents: r.audCents,
      method: input.method,
      reference: input.reference,
    });
    const entry = await postEntry(tx, {
      householdId: actor.householdId,
      memberId: r.memberId,
      type: "CASH_CONVERSION",
      points: -r.points,
      description: `Cash-out ${formatAud(r.audCents)} (${input.method.trim()})`,
      idempotencyKey: `cashout:${r.id}`,
      sourceType: "CASH_OUT",
      sourceId: r.id,
      approvedById: actor.memberId,
      createdById: actor.memberId,
      centsPerPoint: r.centsPerPoint,
      audCents: r.audCents,
      auditLogId: auditId,
    });
    await tx
      .update(cashOutRequest)
      .set({
        status: "PAID",
        approvedAt: r.approvedAt ?? new Date(),
        approvedById: r.approvedById ?? actor.memberId,
        paidAt,
        paidById: actor.memberId,
        method: input.method.trim(),
        reference: input.reference?.trim() || null,
        ledgerEntryId: entry.id,
      })
      .where(eq(cashOutRequest.id, id));
    await notify(tx, actor.householdId, r.memberId, `You've been paid ${formatAud(r.audCents)}`, `${r.points.toLocaleString("en-AU")} Points converted by ${input.method.trim()}.`, "/wallet/cash-out");
  });
}

export async function rejectCashOut(db: DB, actor: Actor, id: string, reason: string) {
  requireRole(actor, "PARENT");
  if (!reason?.trim()) throw new DomainError("Please give a reason.");
  return db.transaction(async (tx) => {
    const r = await loadCashOutForUpdate(tx, actor.householdId, id);
    if (!["REQUESTED", "APPROVED"].includes(r.status)) throw new DomainError("This request is closed.", "STALE");
    await lockMember(tx, actor.householdId, r.memberId);
    await releaseHold(tx, "CASH_OUT", r.id);
    await tx.update(cashOutRequest).set({ status: "REJECTED", rejectedReason: reason.trim() }).where(eq(cashOutRequest.id, id));
    await audit(tx, actor, "cashout.reject", "CashOutRequest", id, { reason });
    await notify(tx, actor.householdId, r.memberId, `Cash-out not approved`, `${reason.trim()} Your Points have been released.`, "/wallet/cash-out");
  });
}

export async function cancelCashOut(db: DB, actor: Actor, id: string) {
  requireRole(actor, "CHILD");
  return db.transaction(async (tx) => {
    const r = await loadCashOutForUpdate(tx, actor.householdId, id);
    if (r.memberId !== actor.memberId) throw new DomainError("Not your request.", "FORBIDDEN");
    if (r.status !== "REQUESTED") throw new DomainError("Only requests awaiting approval can be cancelled.");
    await lockMember(tx, actor.householdId, r.memberId);
    await releaseHold(tx, "CASH_OUT", r.id);
    await tx.update(cashOutRequest).set({ status: "CANCELLED" }).where(eq(cashOutRequest.id, id));
    await audit(tx, actor, "cashout.cancel", "CashOutRequest", id);
  });
}

// ─────────────── Savings goals ───────────────

async function goalBalance(tx: DB | Tx, goalId: string) {
  const [{ n }] = await tx
    .select({ n: sql<number>`COALESCE(SUM(${savingsAllocation.points}), 0)::int` })
    .from(savingsAllocation)
    .where(eq(savingsAllocation.goalId, goalId));
  return n;
}

async function loadGoalForUpdate(tx: Tx, actor: Actor, goalId: string) {
  const [g] = await tx
    .select()
    .from(savingsGoal)
    .where(and(eq(savingsGoal.id, goalId), eq(savingsGoal.householdId, actor.householdId)))
    .for("update");
  if (!g) throw new DomainError("Goal not found.", "NOT_FOUND");
  if (actor.role === "CHILD" && g.memberId !== actor.memberId) throw new DomainError("Not your goal.", "FORBIDDEN");
  return g;
}

export async function createGoal(
  db: DB,
  actor: Actor,
  input: { title: string; targetPoints: number; targetDate?: Date | null; icon?: string; memberId?: string },
) {
  const memberId = actor.role === "PARENT" ? input.memberId : actor.memberId;
  if (!memberId) throw new DomainError("Choose who the goal is for.");
  if (!input.title?.trim()) throw new DomainError("Give your goal a name.");
  assertPositiveInt(input.targetPoints, "Target", 10_000_000);
  return db.transaction(async (tx) => {
    await assertMayRequest(tx, actor);
    const m = await getMemberInHousehold(tx, actor.householdId, memberId);
    if (m.role !== "CHILD") throw new DomainError("Goals are for participant accounts.");
    const [g] = await tx
      .insert(savingsGoal)
      .values({
        householdId: actor.householdId,
        memberId,
        title: input.title.trim(),
        targetPoints: input.targetPoints,
        targetDate: input.targetDate ?? null,
        icon: input.icon || "🎯",
      })
      .returning();
    await audit(tx, actor, "goal.create", "SavingsGoal", g.id, { title: g.title, target: g.targetPoints });
    return g;
  });
}

/** Move Points into (positive) or out of (negative) a goal. Not income or spending. */
export async function moveSavings(db: DB, actor: Actor, goalId: string, points: number) {
  if (!Number.isSafeInteger(points) || points === 0) throw new DomainError("Enter a whole number of Points.");
  return db.transaction(async (tx) => {
    await assertMayRequest(tx, actor);
    const g = await loadGoalForUpdate(tx, actor, goalId);
    await lockMember(tx, actor.householdId, g.memberId);
    if (g.status !== "ACTIVE" && points > 0) throw new DomainError("This goal is closed.");
    if (points > 0) {
      const bal = await getBalances(tx, g.memberId);
      if (bal.available < points) throw new DomainError(insufficientMessage(points, bal.available), "INSUFFICIENT");
    } else {
      if (g.locked && actor.role !== "PARENT") throw new DomainError("This goal is locked. Ask a parent to unlock it.");
      const inGoal = await goalBalance(tx, g.id);
      if (inGoal < -points) throw new DomainError(`Only ${inGoal.toLocaleString("en-AU")} Points are in this goal.`);
    }
    await tx.insert(savingsAllocation).values({ goalId: g.id, memberId: g.memberId, points });
    await audit(tx, actor, points > 0 ? "goal.allocate" : "goal.withdraw", "SavingsGoal", g.id, { points });
  });
}

export async function setGoalLock(db: DB, actor: Actor, goalId: string, locked: boolean) {
  return db.transaction(async (tx) => {
    const g = await loadGoalForUpdate(tx, actor, goalId);
    if (!locked && g.locked && actor.role !== "PARENT") throw new DomainError("Only a parent can unlock a goal.");
    await tx.update(savingsGoal).set({ locked }).where(eq(savingsGoal.id, goalId));
    await audit(tx, actor, locked ? "goal.lock" : "goal.unlock", "SavingsGoal", goalId);
    if (locked && actor.role === "CHILD") {
      await notifyParents(tx, actor.householdId, `${actor.displayName} locked a savings goal`, `"${g.title}" can now only be unlocked by a parent.`);
    }
  });
}

/** Close a goal (reached or abandoned). Its earmarked Points return to available. */
export async function closeGoal(db: DB, actor: Actor, goalId: string, status: "COMPLETED" | "ARCHIVED") {
  return db.transaction(async (tx) => {
    const g = await loadGoalForUpdate(tx, actor, goalId);
    if (g.locked && actor.role !== "PARENT") throw new DomainError("This goal is locked. Ask a parent to unlock it.");
    await lockMember(tx, actor.householdId, g.memberId);
    const inGoal = await goalBalance(tx, g.id);
    if (inGoal > 0) await tx.insert(savingsAllocation).values({ goalId: g.id, memberId: g.memberId, points: -inGoal });
    await tx.update(savingsGoal).set({ status }).where(eq(savingsGoal.id, goalId));
    await audit(tx, actor, `goal.${status.toLowerCase()}`, "SavingsGoal", goalId, { released: inGoal });
  });
}

// ─────────────── Parental awards, direct spends, corrections ───────────────

export type AwardKind = "BONUS" | "MANUAL_AWARD" | "OPENING_BALANCE";

export async function awardPoints(
  db: DB,
  actor: Actor,
  input: { memberId: string; points: number; kind: AwardKind; reason: string; idempotencyKey: string },
) {
  requireRole(actor, "PARENT");
  assertPositiveInt(input.points, "Points", 1_000_000);
  if (!input.reason?.trim()) throw new DomainError("Every award needs a reason.");
  return db.transaction(async (tx) => {
    const m = await lockMember(tx, actor.householdId, input.memberId);
    if (m.role !== "CHILD") throw new DomainError("Points can only be awarded to participant accounts.");
    const key = input.kind === "OPENING_BALANCE" ? `opening:${m.id}` : `award:${input.idempotencyKey}`;
    const [dupe] = await tx.select().from(pointsLedgerEntry).where(eq(pointsLedgerEntry.idempotencyKey, key));
    if (dupe) {
      if (input.kind === "OPENING_BALANCE") throw new DomainError("This person already has an opening balance.");
      return dupe;
    }
    const auditId = await audit(tx, actor, `award.${input.kind.toLowerCase()}`, "HouseholdMember", m.id, {
      points: input.points,
      reason: input.reason,
    });
    const entry = await postEntry(tx, {
      householdId: actor.householdId,
      memberId: m.id,
      type: input.kind,
      points: input.points,
      description: input.reason.trim(),
      idempotencyKey: key,
      sourceType: "AWARD",
      approvedById: actor.memberId,
      createdById: actor.memberId,
      auditLogId: auditId,
    });
    const label = input.kind === "BONUS" ? "bonus" : input.kind === "OPENING_BALANCE" ? "opening balance" : "award";
    await notify(tx, actor.householdId, m.id, `+${input.points.toLocaleString("en-AU")} Points ${label}`, `From ${actor.displayName}: ${input.reason.trim()}`, "/wallet");
    await notifyParents(tx, actor.householdId, `${actor.displayName} gave ${m.displayName} ${input.points} Points`, input.reason.trim(), `/admin/members/${m.id}`, actor.memberId);
    return entry;
  });
}

/**
 * A parent records a spend that happened outside the marketplace (e.g. a treat bought
 * at the shop). Posts as a marketplace purchase with a visible description.
 */
export async function recordDirectSpend(
  db: DB,
  actor: Actor,
  input: { memberId: string; points: number; description: string; idempotencyKey: string },
) {
  requireRole(actor, "PARENT");
  assertPositiveInt(input.points, "Points", 1_000_000);
  if (!input.description?.trim()) throw new DomainError("Describe what the Points were spent on.");
  return db.transaction(async (tx) => {
    const m = await lockMember(tx, actor.householdId, input.memberId);
    if (m.role !== "CHILD") throw new DomainError("Spends are recorded for participant accounts.");
    const key = `spend:${input.idempotencyKey}`;
    const [dupe] = await tx.select().from(pointsLedgerEntry).where(eq(pointsLedgerEntry.idempotencyKey, key));
    if (dupe) return dupe;
    const bal = await getBalances(tx, m.id);
    if (bal.available < input.points) {
      throw new DomainError(`${m.displayName} only has ${bal.available.toLocaleString("en-AU")} Points available.`, "INSUFFICIENT");
    }
    const auditId = await audit(tx, actor, "spend.record", "HouseholdMember", m.id, input);
    const entry = await postEntry(tx, {
      householdId: actor.householdId,
      memberId: m.id,
      type: "MARKETPLACE_PURCHASE",
      points: -input.points,
      description: input.description.trim(),
      idempotencyKey: key,
      sourceType: "DIRECT_SPEND",
      approvedById: actor.memberId,
      createdById: actor.memberId,
      auditLogId: auditId,
    });
    await notify(tx, actor.householdId, m.id, `−${input.points.toLocaleString("en-AU")} Points spent`, `${input.description.trim()} (recorded by ${actor.displayName})`, "/wallet");
    return entry;
  });
}

/**
 * Correct a genuine error. Corrections are always visible ledger entries; nothing is
 * edited or deleted. If `reversesEntryId` is given the correction exactly reverses it.
 * Debit corrections need the other parent's approval when configured.
 */
export async function proposeCorrection(
  db: DB,
  actor: Actor,
  input: { memberId: string; points?: number; reason: string; reversesEntryId?: string | null },
) {
  requireRole(actor, "PARENT");
  if (!input.reason?.trim()) throw new DomainError("Corrections need a reason.");
  return db.transaction(async (tx) => {
    const m = await lockMember(tx, actor.householdId, input.memberId);
    let points = input.points ?? 0;
    if (input.reversesEntryId) {
      const [orig] = await tx
        .select()
        .from(pointsLedgerEntry)
        .where(and(eq(pointsLedgerEntry.id, input.reversesEntryId), eq(pointsLedgerEntry.memberId, m.id)));
      if (!orig) throw new DomainError("Original transaction not found.");
      const [already] = await tx.select().from(pointsLedgerEntry).where(eq(pointsLedgerEntry.reversesEntryId, orig.id));
      if (already) throw new DomainError("That transaction has already been reversed.");
      points = -orig.points;
    }
    if (!Number.isSafeInteger(points) || points === 0) throw new DomainError("Enter a non-zero whole number of Points.");
    const s = await getSettings(tx, actor.householdId);
    const needsSecond = points < 0 && s.correctionsNeedSecondParent;
    const [req] = await tx
      .insert(adjustmentRequest)
      .values({
        householdId: actor.householdId,
        memberId: m.id,
        points,
        reason: input.reason.trim(),
        reversesEntryId: input.reversesEntryId ?? null,
        requestedById: actor.memberId,
      })
      .returning();
    if (points < 0) {
      const bal = await getBalances(tx, m.id);
      if (bal.available < -points) {
        throw new DomainError(
          `${m.displayName} only has ${bal.available.toLocaleString("en-AU")} Points available, so this correction can't be applied without a negative balance.`,
          "INSUFFICIENT",
        );
      }
    }
    if (needsSecond) {
      await createHold(tx, {
        householdId: actor.householdId,
        memberId: m.id,
        points: -points,
        sourceType: "ADJUSTMENT",
        sourceId: req.id,
        description: `Correction pending review: ${input.reason.trim()}`,
      });
      await audit(tx, actor, "correction.propose", "AdjustmentRequest", req.id, { points, reason: input.reason });
      await notifyParents(tx, actor.householdId, `Correction needs your approval`, `${m.displayName}: ${points} Points. ${input.reason.trim()}`, "/admin/approvals", actor.memberId);
      await notify(tx, actor.householdId, m.id, `A correction is under review`, `${points} Points: ${input.reason.trim()}`, "/wallet");
      return { status: "PENDING" as const, request: req };
    }
    await applyCorrection(tx, actor, req, actor.memberId);
    return { status: "APPROVED" as const, request: req };
  });
}

async function applyCorrection(tx: Tx, actor: Actor, req: typeof adjustmentRequest.$inferSelect, approverId: string) {
  const auditId = await audit(tx, actor, "correction.apply", "AdjustmentRequest", req.id, { points: req.points, reason: req.reason });
  const entry = await postEntry(tx, {
    householdId: req.householdId,
    memberId: req.memberId,
    type: "CORRECTION",
    points: req.points,
    description: `Correction: ${req.reason}`,
    idempotencyKey: `adjustment:${req.id}`,
    sourceType: "ADJUSTMENT",
    sourceId: req.id,
    approvedById: approverId,
    createdById: req.requestedById,
    reversesEntryId: req.reversesEntryId ?? undefined,
    auditLogId: auditId,
  });
  await tx
    .update(adjustmentRequest)
    .set({ status: "APPROVED", decidedById: approverId, decidedAt: new Date(), ledgerEntryId: entry.id })
    .where(eq(adjustmentRequest.id, req.id));
  await notify(tx, req.householdId, req.memberId, `Correction: ${req.points > 0 ? "+" : ""}${req.points} Points`, req.reason, "/wallet");
}

export async function decideCorrection(db: DB, actor: Actor, id: string, approve: boolean, reason?: string) {
  requireRole(actor, "PARENT");
  return db.transaction(async (tx) => {
    const [req] = await tx
      .select()
      .from(adjustmentRequest)
      .where(and(eq(adjustmentRequest.id, id), eq(adjustmentRequest.householdId, actor.householdId)))
      .for("update");
    if (!req) throw new DomainError("Correction not found.", "NOT_FOUND");
    if (req.status !== "PENDING") throw new DomainError("This correction has already been decided.", "STALE");
    if (req.requestedById === actor.memberId) throw new DomainError("The other parent needs to review this correction.");
    await lockMember(tx, actor.householdId, req.memberId);
    if (approve) {
      await captureHold(tx, "ADJUSTMENT", req.id);
      await applyCorrection(tx, actor, req, actor.memberId);
    } else {
      await releaseHold(tx, "ADJUSTMENT", req.id);
      await tx
        .update(adjustmentRequest)
        .set({ status: "REJECTED", decidedById: actor.memberId, decidedAt: new Date(), decisionReason: reason ?? null })
        .where(eq(adjustmentRequest.id, id));
      await audit(tx, actor, "correction.reject", "AdjustmentRequest", id, { reason });
      await notify(tx, actor.householdId, req.memberId, `Correction withdrawn`, "The proposed correction was not applied.", "/wallet");
    }
  });
}
