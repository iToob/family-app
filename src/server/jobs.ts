/**
 * The earning economy: opportunities, occurrences, claims, submissions, approvals
 * and child proposals.
 */
import { and, eq, inArray, isNull, lt, ne, notInArray, sql } from "drizzle-orm";
import type { DB, Tx } from "@/db";
import {
  category,
  childProposal,
  earningOpportunity,
  jobApproval,
  jobClaim,
  jobOccurrence,
  jobSubmission,
  projectMilestone,
} from "@/db/schema";
import { currentPeriodStart, localDate, nextPeriod, startOfLocalDate } from "@/lib/time";
import {
  type Actor,
  DomainError,
  assertMayRequest,
  assertPositiveInt,
  audit,
  getHousehold,
  getMemberInHousehold,
  lockMember,
  notify,
  notifyParents,
  postEntry,
  requireRole,
} from "./core";

const ACTIVE_CLAIM_STATUSES = ["CLAIMED", "IN_PROGRESS", "SUBMITTED", "RETURNED", "APPROVED", "PAID"] as const;

export type OpportunityInput = {
  kind: "JOB" | "PROJECT";
  title: string;
  description?: string;
  categoryId?: string | null;
  rewardPoints: number;
  estimatedMinutes?: number | null;
  difficulty?: "EASY" | "MEDIUM" | "HARD";
  requirements?: string | null;
  location?: string | null;
  instructions?: string | null;
  equipment?: string | null;
  safetyNotes?: string | null;
  dueAt?: Date | null;
  positions?: number;
  requiresApproval?: boolean;
  collaborative?: boolean;
  recurrence?: "NONE" | "DAILY" | "WEEKLY" | "FORTNIGHTLY" | "MONTHLY" | "CUSTOM";
  recurrenceEveryDays?: number | null;
  recurrenceAnchor?: string | null; // YYYY-MM-DD
  milestones?: { title: string; rewardPoints: number }[];
  restrictedToMemberId?: string | null;
  proposalId?: string | null;
};

async function assertCategory(tx: Tx, householdId: string, categoryId?: string | null) {
  if (!categoryId) return;
  const [c] = await tx
    .select({ id: category.id })
    .from(category)
    .where(and(eq(category.id, categoryId), eq(category.householdId, householdId), eq(category.kind, "JOB")));
  if (!c) throw new DomainError("Unknown category.");
}

async function insertOpportunity(tx: Tx, actor: Actor, input: OpportunityInput) {
  const h = await getHousehold(tx, actor.householdId);
  await assertCategory(tx, actor.householdId, input.categoryId);
  const isProject = input.kind === "PROJECT";
  const milestones = isProject ? (input.milestones ?? []) : [];
  if (isProject && milestones.length === 0) throw new DomainError("A project needs at least one milestone.");
  for (const m of milestones) assertPositiveInt(m.rewardPoints, "Milestone reward", 100_000);
  const reward = isProject
    ? milestones.reduce((s, m) => s + m.rewardPoints, 0)
    : assertPositiveInt(input.rewardPoints, "Reward", 100_000);
  const recurrence = isProject ? "NONE" : (input.recurrence ?? "NONE");
  if (recurrence === "CUSTOM") assertPositiveInt(input.recurrenceEveryDays, "Repeat interval (days)", 365);
  const positions = isProject ? 1 : assertPositiveInt(input.positions ?? 1, "Positions", 10);

  const [opp] = await tx
    .insert(earningOpportunity)
    .values({
      householdId: actor.householdId,
      kind: input.kind,
      title: input.title.trim(),
      description: input.description?.trim() ?? "",
      categoryId: input.categoryId || null,
      rewardPoints: reward,
      estimatedMinutes: input.estimatedMinutes ?? null,
      difficulty: input.difficulty ?? "EASY",
      requirements: input.requirements || null,
      location: input.location || null,
      instructions: input.instructions || null,
      equipment: input.equipment || null,
      safetyNotes: input.safetyNotes || null,
      dueAt: input.dueAt ?? null,
      positions,
      requiresApproval: input.requiresApproval ?? true,
      collaborative: isProject ? (input.collaborative ?? false) : false,
      recurrence,
      recurrenceEveryDays: recurrence === "CUSTOM" ? input.recurrenceEveryDays! : null,
      recurrenceAnchor: recurrence === "NONE" ? null : (input.recurrenceAnchor ?? localDate(new Date(), h.timezone)),
      restrictedToMemberId: input.restrictedToMemberId ?? null,
      proposalId: input.proposalId ?? null,
      createdById: actor.memberId,
    })
    .returning();

  if (isProject) {
    let i = 0;
    for (const m of milestones) {
      const [ms] = await tx
        .insert(projectMilestone)
        .values({ opportunityId: opp.id, sortOrder: i++, title: m.title.trim(), rewardPoints: m.rewardPoints })
        .returning();
      await tx.insert(jobOccurrence).values({
        opportunityId: opp.id,
        milestoneId: ms.id,
        periodKey: `m:${ms.id}`,
        title: `${opp.title}: ${ms.title}`,
        rewardPoints: ms.rewardPoints,
        dueAt: opp.dueAt,
      });
    }
  } else if (recurrence === "NONE") {
    await tx.insert(jobOccurrence).values({
      opportunityId: opp.id,
      periodKey: "once",
      title: opp.title,
      rewardPoints: opp.rewardPoints,
      dueAt: opp.dueAt,
    });
  } else {
    await ensureOccurrencesFor(tx, opp, h.timezone, new Date());
  }
  await audit(tx, actor, "opportunity.create", "EarningOpportunity", opp.id, {
    title: opp.title,
    reward: opp.rewardPoints,
    recurrence,
  });
  return opp;
}

export async function createOpportunity(db: DB, actor: Actor, input: OpportunityInput) {
  requireRole(actor, "PARENT");
  if (!input.title?.trim()) throw new DomainError("A title is required.");
  return db.transaction((tx) => insertOpportunity(tx, actor, input));
}

/** Edit an opportunity. Reward changes apply to new and unclaimed occurrences only. */
export async function updateOpportunity(db: DB, actor: Actor, id: string, input: Partial<OpportunityInput>) {
  requireRole(actor, "PARENT");
  return db.transaction(async (tx) => {
    const [opp] = await tx
      .select()
      .from(earningOpportunity)
      .where(and(eq(earningOpportunity.id, id), eq(earningOpportunity.householdId, actor.householdId)))
      .for("update");
    if (!opp) throw new DomainError("Job not found.", "NOT_FOUND");
    await assertCategory(tx, actor.householdId, input.categoryId);
    const patch: Partial<typeof earningOpportunity.$inferInsert> = {};
    if (input.title !== undefined) patch.title = input.title.trim();
    if (input.description !== undefined) patch.description = input.description ?? "";
    if (input.categoryId !== undefined) patch.categoryId = input.categoryId || null;
    if (input.estimatedMinutes !== undefined) patch.estimatedMinutes = input.estimatedMinutes;
    if (input.difficulty !== undefined) patch.difficulty = input.difficulty;
    for (const k of ["requirements", "location", "instructions", "equipment", "safetyNotes"] as const) {
      if (input[k] !== undefined) patch[k] = input[k] || null;
    }
    if (input.dueAt !== undefined) patch.dueAt = input.dueAt;
    if (input.positions !== undefined) patch.positions = assertPositiveInt(input.positions, "Positions", 10);
    if (input.requiresApproval !== undefined) patch.requiresApproval = input.requiresApproval;
    if (opp.kind === "JOB" && input.rewardPoints !== undefined) {
      patch.rewardPoints = assertPositiveInt(input.rewardPoints, "Reward", 100_000);
    }
    const [updated] = await tx.update(earningOpportunity).set(patch).where(eq(earningOpportunity.id, id)).returning();

    if (patch.rewardPoints !== undefined || patch.title !== undefined || patch.dueAt !== undefined) {
      // Refresh open occurrences that nobody has claimed yet. Claimed work keeps its agreed reward.
      const open = await tx
        .select({ id: jobOccurrence.id })
        .from(jobOccurrence)
        .where(and(eq(jobOccurrence.opportunityId, id), eq(jobOccurrence.status, "OPEN"), isNull(jobOccurrence.milestoneId)));
      for (const o of open) {
        const claims = await tx.select({ id: jobClaim.id }).from(jobClaim).where(eq(jobClaim.occurrenceId, o.id));
        if (claims.length === 0) {
          await tx
            .update(jobOccurrence)
            .set({
              rewardPoints: updated.rewardPoints,
              title: updated.title,
              ...(opp.recurrence === "NONE" ? { dueAt: updated.dueAt } : {}),
            })
            .where(eq(jobOccurrence.id, o.id));
        }
      }
    }
    await audit(tx, actor, "opportunity.update", "EarningOpportunity", id, { before: opp, changes: patch });
    return updated;
  });
}

export async function setOpportunityStatus(db: DB, actor: Actor, id: string, status: "ACTIVE" | "PAUSED" | "ARCHIVED") {
  requireRole(actor, "PARENT");
  return db.transaction(async (tx) => {
    const [opp] = await tx
      .update(earningOpportunity)
      .set({ status })
      .where(and(eq(earningOpportunity.id, id), eq(earningOpportunity.householdId, actor.householdId)))
      .returning();
    if (!opp) throw new DomainError("Job not found.", "NOT_FOUND");
    if (status === "ACTIVE" && opp.recurrence !== "NONE") {
      const h = await getHousehold(tx, actor.householdId);
      await ensureOccurrencesFor(tx, opp, h.timezone, new Date());
    }
    await audit(tx, actor, `opportunity.${status.toLowerCase()}`, "EarningOpportunity", id);
    return opp;
  });
}

/**
 * Create the occurrence for the current recurrence period (idempotent via the unique
 * (opportunity, periodKey) index) and expire earlier unclaimed periods.
 */
export async function ensureOccurrencesFor(
  tx: Tx,
  opp: typeof earningOpportunity.$inferSelect,
  tz: string,
  now: Date,
) {
  if (opp.recurrence === "NONE" || opp.status !== "ACTIVE" || !opp.recurrenceAnchor) return;
  const today = localDate(now, tz);
  const start = currentPeriodStart(opp.recurrenceAnchor, today, opp.recurrence, opp.recurrenceEveryDays);
  if (!start) return;
  const anchorDay = Number(opp.recurrenceAnchor.slice(8, 10));
  const end = nextPeriod(start, opp.recurrence, opp.recurrenceEveryDays, anchorDay);
  await tx
    .insert(jobOccurrence)
    .values({
      opportunityId: opp.id,
      periodKey: start,
      title: opp.title,
      rewardPoints: opp.rewardPoints,
      availableFrom: startOfLocalDate(start, tz),
      dueAt: startOfLocalDate(end, tz),
    })
    .onConflictDoNothing();
  // Earlier periods close to new claims. Work already claimed can still be finished and paid.
  await tx
    .update(jobOccurrence)
    .set({ status: "EXPIRED" })
    .where(and(eq(jobOccurrence.opportunityId, opp.id), eq(jobOccurrence.status, "OPEN"), lt(jobOccurrence.periodKey, start)));
}

export async function ensureAllOccurrences(tx: Tx, householdId: string, tz: string, now = new Date()) {
  const opps = await tx
    .select()
    .from(earningOpportunity)
    .where(
      and(
        eq(earningOpportunity.householdId, householdId),
        eq(earningOpportunity.status, "ACTIVE"),
        ne(earningOpportunity.recurrence, "NONE"),
      ),
    );
  for (const o of opps) await ensureOccurrencesFor(tx, o, tz, now);
  // One-off jobs past their due date with no claims expire.
  await tx.execute(sql`
    UPDATE job_occurrence o SET status = 'EXPIRED'
    FROM earning_opportunity e
    WHERE o.opportunity_id = e.id AND e.household_id = ${householdId}
      AND o.status = 'OPEN' AND o.period_key = 'once' AND o.due_at IS NOT NULL AND o.due_at < ${now}
      AND NOT EXISTS (SELECT 1 FROM job_claim c WHERE c.occurrence_id = o.id AND c.status NOT IN ('CANCELLED','REJECTED'))
  `);
}

// ─────────────── Claims ───────────────

async function loadOccurrenceForUpdate(tx: Tx, householdId: string, occurrenceId: string) {
  const rows = await tx
    .select({ occ: jobOccurrence, opp: earningOpportunity })
    .from(jobOccurrence)
    .innerJoin(earningOpportunity, eq(jobOccurrence.opportunityId, earningOpportunity.id))
    .where(and(eq(jobOccurrence.id, occurrenceId), eq(earningOpportunity.householdId, householdId)))
    .for("update", { of: jobOccurrence });
  if (!rows[0]) throw new DomainError("Job not found.", "NOT_FOUND");
  return rows[0];
}

export async function claimJob(db: DB, actor: Actor, occurrenceId: string) {
  requireRole(actor, "CHILD");
  return db.transaction(async (tx) => {
    await assertMayRequest(tx, actor);
    const me = await getMemberInHousehold(tx, actor.householdId, actor.memberId);
    if (me.participationStatus !== "ACTIVE") {
      throw new DomainError("Your participation is paused. Resume participation to claim new jobs.");
    }
    const { occ, opp } = await loadOccurrenceForUpdate(tx, actor.householdId, occurrenceId);
    if (occ.status !== "OPEN" || opp.status !== "ACTIVE") throw new DomainError("This job is no longer available.");
    if (occ.availableFrom > new Date()) throw new DomainError("This job isn't available yet.");
    if (opp.restrictedToMemberId && opp.restrictedToMemberId !== actor.memberId) {
      throw new DomainError("This job is reserved for someone else.");
    }
    const claims = await tx.select().from(jobClaim).where(eq(jobClaim.occurrenceId, occ.id));
    const mine = claims.find((c) => c.memberId === actor.memberId);
    if (mine && mine.status !== "CANCELLED") throw new DomainError("You've already claimed this job.");
    const active = claims.filter((c) => (ACTIVE_CLAIM_STATUSES as readonly string[]).includes(c.status));
    const positions = opp.kind === "PROJECT" ? 1 : opp.positions;
    if (active.length >= positions) throw new DomainError("Sorry, someone has already claimed this job.");

    if (opp.kind === "PROJECT" && !opp.collaborative) {
      // An individual project belongs to whoever starts it.
      const others = await tx.execute<{ n: string }>(sql`
        SELECT COUNT(*) AS n FROM job_claim c JOIN job_occurrence o ON o.id = c.occurrence_id
        WHERE o.opportunity_id = ${opp.id} AND c.member_id <> ${actor.memberId}
          AND c.status NOT IN ('CANCELLED','REJECTED')`);
      if (Number(others.rows[0].n) > 0) throw new DomainError("Someone else is already doing this project.");
    }

    let claim;
    if (mine) {
      [claim] = await tx
        .update(jobClaim)
        .set({ status: "CLAIMED", claimedAt: new Date() })
        .where(eq(jobClaim.id, mine.id))
        .returning();
    } else {
      [claim] = await tx.insert(jobClaim).values({ occurrenceId: occ.id, memberId: actor.memberId }).returning();
    }
    await audit(tx, actor, "job.claim", "JobClaim", claim.id, { occurrence: occ.id, title: occ.title });
    return claim;
  });
}

async function loadClaimForUpdate(tx: Tx, householdId: string, claimId: string) {
  const rows = await tx
    .select({ claim: jobClaim, occ: jobOccurrence, opp: earningOpportunity })
    .from(jobClaim)
    .innerJoin(jobOccurrence, eq(jobClaim.occurrenceId, jobOccurrence.id))
    .innerJoin(earningOpportunity, eq(jobOccurrence.opportunityId, earningOpportunity.id))
    .where(and(eq(jobClaim.id, claimId), eq(earningOpportunity.householdId, householdId)))
    .for("update", { of: jobClaim });
  if (!rows[0]) throw new DomainError("Claim not found.", "NOT_FOUND");
  return rows[0];
}

export async function startJob(db: DB, actor: Actor, claimId: string) {
  requireRole(actor, "CHILD");
  return db.transaction(async (tx) => {
    const { claim } = await loadClaimForUpdate(tx, actor.householdId, claimId);
    if (claim.memberId !== actor.memberId) throw new DomainError("That isn't your job.", "FORBIDDEN");
    if (claim.status !== "CLAIMED") return claim;
    const [c] = await tx.update(jobClaim).set({ status: "IN_PROGRESS" }).where(eq(jobClaim.id, claimId)).returning();
    return c;
  });
}

export async function cancelClaim(db: DB, actor: Actor, claimId: string) {
  return db.transaction(async (tx) => {
    const { claim, occ } = await loadClaimForUpdate(tx, actor.householdId, claimId);
    if (actor.role === "CHILD" && claim.memberId !== actor.memberId) throw new DomainError("That isn't your job.", "FORBIDDEN");
    if (!["CLAIMED", "IN_PROGRESS", "RETURNED"].includes(claim.status)) {
      throw new DomainError("This job can't be released now.");
    }
    const [c] = await tx.update(jobClaim).set({ status: "CANCELLED" }).where(eq(jobClaim.id, claimId)).returning();
    await audit(tx, actor, "job.release", "JobClaim", claimId, { title: occ.title });
    if (actor.role === "PARENT") {
      await notify(tx, actor.householdId, claim.memberId, `"${occ.title}" was released`, "A parent released this job claim.", "/earn");
    }
    return c;
  });
}

export async function submitJob(
  db: DB,
  actor: Actor,
  claimId: string,
  input: { notes?: string | null; minutesSpent?: number | null; photo?: Buffer | null; photoType?: string | null },
) {
  requireRole(actor, "CHILD");
  const result = await db.transaction(async (tx) => {
    await assertMayRequest(tx, actor);
    const { claim, occ, opp } = await loadClaimForUpdate(tx, actor.householdId, claimId);
    if (claim.memberId !== actor.memberId) throw new DomainError("That isn't your job.", "FORBIDDEN");
    if (!["CLAIMED", "IN_PROGRESS", "RETURNED"].includes(claim.status)) {
      throw new DomainError("This job has already been submitted.");
    }
    if (input.photo && input.photo.length > 3_000_000) throw new DomainError("Photo is too large (max 3 MB).");
    await tx.insert(jobSubmission).values({
      claimId,
      notes: input.notes || null,
      minutesSpent: input.minutesSpent ?? null,
      photo: input.photo ?? null,
      photoType: input.photo ? (input.photoType ?? "image/jpeg") : null,
    });
    await tx.update(jobClaim).set({ status: "SUBMITTED" }).where(eq(jobClaim.id, claimId));
    await audit(tx, actor, "job.submit", "JobClaim", claimId, { title: occ.title });
    if (opp.requiresApproval) {
      await notifyParents(
        tx,
        actor.householdId,
        `${actor.displayName} finished "${occ.title}"`,
        `${occ.rewardPoints} Points awaiting your approval.`,
        "/admin/approvals",
      );
    }
    return { autoApprove: !opp.requiresApproval };
  });
  if (result.autoApprove) {
    await approveClaimInternal(db, actor.householdId, null, claimId, "APPROVED", undefined, "Automatically approved");
  }
  return result;
}

export type ReviewDecision = "APPROVED" | "PARTIAL" | "RETURNED" | "REJECTED";

export async function reviewJob(
  db: DB,
  actor: Actor,
  claimId: string,
  decision: ReviewDecision,
  opts: { points?: number; reason?: string } = {},
) {
  requireRole(actor, "PARENT");
  return approveClaimInternal(db, actor.householdId, actor, claimId, decision, opts.points, opts.reason);
}

async function approveClaimInternal(
  db: DB,
  householdId: string,
  actor: Actor | null,
  claimId: string,
  decision: ReviewDecision,
  partialPoints?: number,
  reason?: string,
) {
  return db.transaction(async (tx) => {
    const { claim, occ, opp } = await loadClaimForUpdate(tx, householdId, claimId);
    if (actor && claim.memberId === actor.memberId) throw new DomainError("You can't approve your own work.", "FORBIDDEN");
    if (claim.status !== "SUBMITTED") {
      throw new DomainError(
        claim.status === "PAID" ? "This job has already been approved and paid." : "This job isn't waiting for approval.",
        "STALE",
      );
    }
    if (decision !== "APPROVED" && !reason?.trim()) throw new DomainError("Please give a reason.");

    let points = 0;
    if (decision === "APPROVED") points = occ.rewardPoints;
    if (decision === "PARTIAL") {
      points = assertPositiveInt(partialPoints, "Partial payment", occ.rewardPoints);
      if (points >= occ.rewardPoints) decision = "APPROVED";
    }
    const actorMemberId = actor?.memberId ?? null;
    await tx.insert(jobApproval).values({
      claimId,
      decision,
      pointsAwarded: points,
      reason: reason?.trim() || null,
      decidedById: actorMemberId,
    });

    const nextStatus = decision === "RETURNED" ? "RETURNED" : decision === "REJECTED" ? "REJECTED" : "PAID";
    await tx.update(jobClaim).set({ status: nextStatus }).where(eq(jobClaim.id, claimId));

    const auditActor = { householdId, memberId: actorMemberId } as { householdId: string; memberId: string };
    const auditId = await audit(tx, auditActor, `job.${decision.toLowerCase()}`, "JobClaim", claimId, {
      title: occ.title,
      points,
      reason,
    });

    if (points > 0) {
      await lockMember(tx, householdId, claim.memberId);
      let catName: string | null = null;
      if (opp.categoryId) {
        const [c] = await tx.select({ name: category.name }).from(category).where(eq(category.id, opp.categoryId));
        catName = c?.name ?? null;
      }
      await postEntry(tx, {
        householdId,
        memberId: claim.memberId,
        type: "JOB_EARNING",
        points,
        description: decision === "PARTIAL" ? `${occ.title} (partial payment)` : occ.title,
        idempotencyKey: `job:${claimId}`,
        sourceType: "JOB_CLAIM",
        sourceId: claimId,
        approvedById: actorMemberId,
        createdById: actorMemberId,
        category: catName,
        auditLogId: auditId,
      });
      // A one-off with all positions paid is closed.
      const paid = await tx
        .select({ id: jobClaim.id })
        .from(jobClaim)
        .where(and(eq(jobClaim.occurrenceId, occ.id), eq(jobClaim.status, "PAID")));
      const positions = opp.kind === "PROJECT" ? 1 : opp.positions;
      if (paid.length >= positions) await tx.update(jobOccurrence).set({ status: "CLOSED" }).where(eq(jobOccurrence.id, occ.id));
    }

    const msg =
      decision === "APPROVED"
        ? [`You earned ${points.toLocaleString("en-AU")} Points`, `"${occ.title}" was approved.`]
        : decision === "PARTIAL"
          ? [`You earned ${points.toLocaleString("en-AU")} Points (partial)`, `"${occ.title}": ${reason}`]
          : decision === "RETURNED"
            ? [`"${occ.title}" needs a few fixes`, reason ?? ""]
            : [`"${occ.title}" was not approved`, reason ?? ""];
    await notify(tx, householdId, claim.memberId, msg[0], msg[1], decision === "RETURNED" ? `/earn/claim/${claimId}` : "/wallet");
    return { points, decision };
  });
}

/**
 * A parent records that a child completed a job (e.g. the child is view-only, or the
 * work was agreed in person). Creates the claim and pays it in one step.
 */
export async function recordJobForChild(db: DB, actor: Actor, occurrenceId: string, memberId: string, note?: string) {
  requireRole(actor, "PARENT");
  const claimId = await db.transaction(async (tx) => {
    const child = await getMemberInHousehold(tx, actor.householdId, memberId);
    if (child.role !== "CHILD") throw new DomainError("Jobs are recorded for participant accounts.");
    const { occ, opp } = await loadOccurrenceForUpdate(tx, actor.householdId, occurrenceId);
    if (occ.status !== "OPEN") throw new DomainError("This job is no longer open.");
    const claims = await tx.select().from(jobClaim).where(eq(jobClaim.occurrenceId, occ.id));
    const existing = claims.find((c) => c.memberId === memberId);
    if (existing && !["CANCELLED", "CLAIMED", "IN_PROGRESS", "RETURNED"].includes(existing.status)) {
      throw new DomainError(existing.status === "PAID" ? "This has already been paid." : "This job is already with you for approval.");
    }
    const active = claims.filter((c) => c.memberId !== memberId && (ACTIVE_CLAIM_STATUSES as readonly string[]).includes(c.status));
    const positions = opp.kind === "PROJECT" ? 1 : opp.positions;
    if (active.length >= positions) throw new DomainError("All positions for this job are taken.");
    let id: string;
    if (existing) {
      await tx.update(jobClaim).set({ status: "SUBMITTED" }).where(eq(jobClaim.id, existing.id));
      id = existing.id;
    } else {
      const [c] = await tx.insert(jobClaim).values({ occurrenceId: occ.id, memberId, status: "SUBMITTED" }).returning();
      id = c.id;
    }
    await tx.insert(jobSubmission).values({ claimId: id, notes: note?.trim() || `Recorded by ${actor.displayName}` });
    await audit(tx, actor, "job.record_for_child", "JobClaim", id, { title: occ.title, memberId });
    return id;
  });
  return approveClaimInternal(db, actor.householdId, actor, claimId, "APPROVED");
}

// ─────────────── Proposals ───────────────

export type ProposalInput = {
  title: string;
  whatToDo: string;
  beneficiaries: string;
  estimatedMinutes?: number | null;
  proposedPoints: number;
  materials?: string | null;
  costs?: string | null;
  valueReason: string;
};

export async function submitProposal(db: DB, actor: Actor, input: ProposalInput) {
  requireRole(actor, "CHILD");
  assertPositiveInt(input.proposedPoints, "Proposed reward", 100_000);
  return db.transaction(async (tx) => {
    await assertMayRequest(tx, actor);
    const [p] = await tx
      .insert(childProposal)
      .values({ householdId: actor.householdId, memberId: actor.memberId, ...input })
      .returning();
    await audit(tx, actor, "proposal.submit", "ChildProposal", p.id, { title: p.title, points: p.proposedPoints });
    await notifyParents(
      tx,
      actor.householdId,
      `${actor.displayName} proposed a job`,
      `"${p.title}" for ${p.proposedPoints} Points`,
      "/admin/approvals",
    );
    return p;
  });
}

async function loadProposalForUpdate(tx: Tx, householdId: string, id: string) {
  const [p] = await tx
    .select()
    .from(childProposal)
    .where(and(eq(childProposal.id, id), eq(childProposal.householdId, householdId)))
    .for("update");
  if (!p) throw new DomainError("Proposal not found.", "NOT_FOUND");
  return p;
}

async function convertProposal(tx: Tx, actor: Actor, p: typeof childProposal.$inferSelect, reward: number, parentId: string) {
  const opp = await insertOpportunity(tx, { ...actor, memberId: parentId, role: "PARENT" }, {
    kind: "JOB",
    title: p.title,
    description: p.whatToDo,
    rewardPoints: reward,
    estimatedMinutes: p.estimatedMinutes,
    equipment: p.materials,
    restrictedToMemberId: p.memberId,
    proposalId: p.id,
  });
  await tx
    .update(childProposal)
    .set({ status: "APPROVED", opportunityId: opp.id })
    .where(eq(childProposal.id, p.id));
  return opp;
}

export async function respondToProposal(
  db: DB,
  actor: Actor,
  id: string,
  action: "APPROVE" | "COUNTER" | "DECLINE" | "INFO",
  opts: { points?: number; message?: string } = {},
) {
  requireRole(actor, "PARENT");
  return db.transaction(async (tx) => {
    const p = await loadProposalForUpdate(tx, actor.householdId, id);
    if (!["PENDING", "COUNTERED"].includes(p.status)) throw new DomainError("This proposal has already been answered.", "STALE");
    const message = opts.message?.trim() || null;
    if ((action === "DECLINE" || action === "INFO") && !message) throw new DomainError("Please add an explanation.");
    const base = { decidedById: actor.memberId, parentResponse: message };
    if (action === "APPROVE") {
      await tx.update(childProposal).set(base).where(eq(childProposal.id, id));
      await convertProposal(tx, actor, p, p.proposedPoints, actor.memberId);
      await notify(tx, actor.householdId, p.memberId, `Your proposal "${p.title}" was approved`, `It's now on your job board for ${p.proposedPoints} Points.`, "/earn");
    } else if (action === "COUNTER") {
      const pts = assertPositiveInt(opts.points, "Counter-offer", 100_000);
      await tx.update(childProposal).set({ ...base, status: "COUNTERED", counterPoints: pts }).where(eq(childProposal.id, id));
      await notify(tx, actor.householdId, p.memberId, `Counter-offer on "${p.title}"`, `A parent offered ${pts} Points.${message ? " " + message : ""}`, "/earn/proposals");
    } else if (action === "DECLINE") {
      await tx.update(childProposal).set({ ...base, status: "DECLINED" }).where(eq(childProposal.id, id));
      await notify(tx, actor.householdId, p.memberId, `Proposal "${p.title}" declined`, message!, "/earn/proposals");
    } else {
      await tx.update(childProposal).set({ ...base, status: "INFO_REQUESTED" }).where(eq(childProposal.id, id));
      await notify(tx, actor.householdId, p.memberId, `More info needed on "${p.title}"`, message!, "/earn/proposals");
    }
    await audit(tx, actor, `proposal.${action.toLowerCase()}`, "ChildProposal", id, { points: opts.points, message });
  });
}

export async function childRespondToProposal(
  db: DB,
  actor: Actor,
  id: string,
  action: "ACCEPT" | "DECLINE_COUNTER" | "RESUBMIT" | "WITHDRAW",
  opts: { message?: string; update?: Partial<ProposalInput> } = {},
) {
  requireRole(actor, "CHILD");
  return db.transaction(async (tx) => {
    await assertMayRequest(tx, actor);
    const p = await loadProposalForUpdate(tx, actor.householdId, id);
    if (p.memberId !== actor.memberId) throw new DomainError("That isn't your proposal.", "FORBIDDEN");
    const message = opts.message?.trim() || null;
    if (action === "ACCEPT") {
      if (p.status !== "COUNTERED" || !p.counterPoints) throw new DomainError("There's no offer to accept.");
      await tx.update(childProposal).set({ childResponse: message }).where(eq(childProposal.id, id));
      await convertProposal(tx, actor, p, p.counterPoints, p.decidedById ?? actor.memberId);
      await notifyParents(tx, actor.householdId, `${actor.displayName} accepted your offer`, `"${p.title}" for ${p.counterPoints} Points`, "/admin/jobs");
    } else if (action === "DECLINE_COUNTER") {
      if (p.status !== "COUNTERED") throw new DomainError("There's no offer to decline.");
      await tx.update(childProposal).set({ status: "WITHDRAWN", childResponse: message }).where(eq(childProposal.id, id));
    } else if (action === "RESUBMIT") {
      if (!["INFO_REQUESTED", "COUNTERED"].includes(p.status)) throw new DomainError("This proposal can't be changed now.");
      const u = opts.update ?? {};
      if (u.proposedPoints !== undefined) assertPositiveInt(u.proposedPoints, "Proposed reward", 100_000);
      await tx
        .update(childProposal)
        .set({ ...u, status: "PENDING", childResponse: message, counterPoints: null })
        .where(eq(childProposal.id, id));
      await notifyParents(tx, actor.householdId, `${actor.displayName} updated a proposal`, `"${p.title}"`, "/admin/approvals");
    } else {
      if (["APPROVED", "DECLINED", "WITHDRAWN"].includes(p.status)) throw new DomainError("This proposal is closed.");
      await tx.update(childProposal).set({ status: "WITHDRAWN", childResponse: message }).where(eq(childProposal.id, id));
    }
    await audit(tx, actor, `proposal.child_${action.toLowerCase()}`, "ChildProposal", id, { message });
  });
}

// ─────────────── Queries ───────────────

/** Jobs a child can claim right now. */
export async function listAvailableJobs(db: DB, actor: Actor) {
  const rows = await db.execute<{
    occurrence_id: string;
    opportunity_id: string;
    title: string;
    reward_points: number;
    due_at: Date | null;
    kind: string;
    description: string;
    estimated_minutes: number | null;
    difficulty: string;
    requirements: string | null;
    category_name: string | null;
    category_icon: string | null;
    positions: number;
    taken: string;
    recurrence: string;
  }>(sql`
    SELECT o.id AS occurrence_id, e.id AS opportunity_id, o.title, o.reward_points, o.due_at, e.kind,
           e.description, e.estimated_minutes, e.difficulty, e.requirements, c.name AS category_name,
           c.icon AS category_icon, e.positions, e.recurrence,
           (SELECT COUNT(*) FROM job_claim jc WHERE jc.occurrence_id = o.id AND jc.status NOT IN ('CANCELLED','REJECTED')) AS taken
    FROM job_occurrence o
    JOIN earning_opportunity e ON e.id = o.opportunity_id
    LEFT JOIN category c ON c.id = e.category_id
    WHERE e.household_id = ${actor.householdId}
      AND e.status = 'ACTIVE' AND o.status = 'OPEN' AND o.available_from <= now()
      AND (e.restricted_to_member_id IS NULL OR e.restricted_to_member_id = ${actor.memberId})
      AND NOT EXISTS (SELECT 1 FROM job_claim mine WHERE mine.occurrence_id = o.id AND mine.member_id = ${actor.memberId} AND mine.status <> 'CANCELLED')
      AND NOT (e.kind = 'PROJECT' AND e.collaborative = false AND EXISTS (
        SELECT 1 FROM job_claim x JOIN job_occurrence xo ON xo.id = x.occurrence_id
        WHERE xo.opportunity_id = e.id AND x.member_id <> ${actor.memberId} AND x.status NOT IN ('CANCELLED','REJECTED')))
    ORDER BY o.reward_points DESC
  `);
  return rows.rows
    .filter((r) => Number(r.taken) < (r.kind === "PROJECT" ? 1 : r.positions))
    .map((r) => ({ ...r, taken: Number(r.taken) }));
}

export async function listMyClaims(db: DB, actor: Actor, statuses: string[]) {
  return db
    .select({ claim: jobClaim, occ: jobOccurrence, opp: earningOpportunity })
    .from(jobClaim)
    .innerJoin(jobOccurrence, eq(jobClaim.occurrenceId, jobOccurrence.id))
    .innerJoin(earningOpportunity, eq(jobOccurrence.opportunityId, earningOpportunity.id))
    .where(
      and(
        eq(jobClaim.memberId, actor.memberId),
        eq(earningOpportunity.householdId, actor.householdId),
        inArray(jobClaim.status, statuses as (typeof jobClaim.$inferSelect)["status"][]),
      ),
    )
    .orderBy(sql`${jobClaim.updatedAt} DESC`);
}

export { ACTIVE_CLAIM_STATUSES, notInArray };
