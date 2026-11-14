/**
 * Read models for pages. Every query is scoped by householdId (and memberId where the
 * data is personal). Callers pass identifiers that came from a verified session.
 */
import { and, desc, eq, gte, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import type { DB } from "@/db";
import {
  adjustmentRequest,
  auditLog,
  cashOutRequest,
  category,
  charterAcknowledgement,
  charterVersion,
  childProposal,
  dispute,
  earningOpportunity,
  entitlement,
  householdMember,
  jobClaim,
  jobOccurrence,
  jobSubmission,
  marketplaceItem,
  notification,
  pointsHold,
  pointsLedgerEntry,
  purchase,
  savingsAllocation,
  savingsGoal,
  subscription,
} from "@/db/schema";
import { localDate, startOfLocalDate, startOfMonth, startOfWeek, addDays, addMonths } from "@/lib/time";
import { getBalances, getSettings } from "./core";

export async function wallet(db: DB, memberId: string) {
  const b = await getBalances(db, memberId);
  const r = await db.execute<{ earned: string; spent: string; converted: string; pending: string }>(sql`
    SELECT
      (SELECT COALESCE(SUM(points),0) FROM points_ledger_entry WHERE member_id = ${memberId}
         AND type IN ('JOB_EARNING','BONUS','MANUAL_AWARD','OPENING_BALANCE')) AS earned,
      (SELECT COALESCE(-SUM(points),0) FROM points_ledger_entry WHERE member_id = ${memberId}
         AND type IN ('MARKETPLACE_PURCHASE','SUBSCRIPTION_PAYMENT','REFUND')) AS spent,
      (SELECT COALESCE(-SUM(points),0) FROM points_ledger_entry WHERE member_id = ${memberId} AND type = 'CASH_CONVERSION') AS converted,
      (SELECT COALESCE(SUM(o.reward_points),0) FROM job_claim c JOIN job_occurrence o ON o.id = c.occurrence_id
         WHERE c.member_id = ${memberId} AND c.status = 'SUBMITTED') AS pending
  `);
  const x = r.rows[0];
  return {
    ...b,
    lifetimeEarned: Number(x.earned),
    lifetimeSpent: Number(x.spent),
    lifetimeConverted: Number(x.converted),
    pendingEarnings: Number(x.pending),
  };
}

export async function transactions(db: DB, memberId: string, opts: { limit?: number; q?: string; type?: string } = {}) {
  const conds = [eq(pointsLedgerEntry.memberId, memberId)];
  if (opts.q) conds.push(ilike(pointsLedgerEntry.description, `%${opts.q}%`));
  if (opts.type) conds.push(eq(pointsLedgerEntry.type, opts.type as (typeof pointsLedgerEntry.$inferSelect)["type"]));
  return db
    .select()
    .from(pointsLedgerEntry)
    .where(and(...conds))
    .orderBy(desc(pointsLedgerEntry.occurredAt))
    .limit(opts.limit ?? 200);
}

export async function activeHolds(db: DB, memberId: string) {
  return db
    .select()
    .from(pointsHold)
    .where(and(eq(pointsHold.memberId, memberId), eq(pointsHold.status, "ACTIVE")))
    .orderBy(desc(pointsHold.createdAt));
}

export async function goals(db: DB, memberId: string, includeClosed = false) {
  const rows = await db
    .select({
      goal: savingsGoal,
      saved: sql<number>`COALESCE((SELECT SUM(a.points) FROM savings_allocation a WHERE a.goal_id = "savings_goal"."id"), 0)::int`,
    })
    .from(savingsGoal)
    .where(and(eq(savingsGoal.memberId, memberId), ...(includeClosed ? [] : [eq(savingsGoal.status, "ACTIVE")])))
    .orderBy(desc(savingsGoal.createdAt));
  return rows.map((r) => ({ ...r.goal, saved: r.saved, pct: Math.min(100, Math.floor((r.saved * 100) / r.goal.targetPoints)) }));
}

export async function notifications(db: DB, memberId: string, limit = 50) {
  return db.select().from(notification).where(eq(notification.memberId, memberId)).orderBy(desc(notification.createdAt)).limit(limit);
}

export async function unreadCount(db: DB, memberId: string) {
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notification)
    .where(and(eq(notification.memberId, memberId), isNull(notification.readAt)));
  return n;
}

export async function members(db: DB, householdId: string, includeArchived = false) {
  return db
    .select()
    .from(householdMember)
    .where(and(eq(householdMember.householdId, householdId), ...(includeArchived ? [] : [isNull(householdMember.archivedAt)])))
    .orderBy(householdMember.role, householdMember.createdAt);
}

export async function children(db: DB, householdId: string) {
  return (await members(db, householdId)).filter((m) => m.role === "CHILD");
}

export async function categories(db: DB, householdId: string, kind: "JOB" | "MARKET") {
  return db
    .select()
    .from(category)
    .where(and(eq(category.householdId, householdId), eq(category.kind, kind), isNull(category.archivedAt)))
    .orderBy(category.sortOrder, category.name);
}

export async function marketplace(db: DB, householdId: string, includeHidden = false) {
  return db
    .select({ item: marketplaceItem, categoryName: category.name, categoryIcon: category.icon })
    .from(marketplaceItem)
    .leftJoin(category, eq(marketplaceItem.categoryId, category.id))
    .where(
      and(
        eq(marketplaceItem.householdId, householdId),
        ...(includeHidden ? [] : [isNull(marketplaceItem.archivedAt), eq(marketplaceItem.available, true)]),
      ),
    )
    .orderBy(category.sortOrder, marketplaceItem.pricePoints);
}

export async function opportunities(db: DB, householdId: string) {
  return db
    .select({
      opp: earningOpportunity,
      categoryName: category.name,
      categoryIcon: category.icon,
      openOccurrences: sql<number>`(SELECT count(*) FROM job_occurrence o WHERE o.opportunity_id = "earning_opportunity"."id" AND o.status = 'OPEN')::int`,
      activeClaims: sql<number>`(SELECT count(*) FROM job_claim c JOIN job_occurrence o ON o.id = c.occurrence_id WHERE o.opportunity_id = "earning_opportunity"."id" AND c.status IN ('CLAIMED','IN_PROGRESS','SUBMITTED','RETURNED'))::int`,
    })
    .from(earningOpportunity)
    .leftJoin(category, eq(earningOpportunity.categoryId, category.id))
    .where(eq(earningOpportunity.householdId, householdId))
    .orderBy(earningOpportunity.status, desc(earningOpportunity.createdAt));
}

/** Open occurrences a parent can record against a child. */
export async function openOccurrences(db: DB, householdId: string) {
  return db
    .select({ occ: jobOccurrence, opp: earningOpportunity })
    .from(jobOccurrence)
    .innerJoin(earningOpportunity, eq(jobOccurrence.opportunityId, earningOpportunity.id))
    .where(and(eq(earningOpportunity.householdId, householdId), eq(earningOpportunity.status, "ACTIVE"), eq(jobOccurrence.status, "OPEN")))
    .orderBy(jobOccurrence.title);
}

export async function claimDetail(db: DB, householdId: string, claimId: string) {
  const [r] = await db
    .select({ claim: jobClaim, occ: jobOccurrence, opp: earningOpportunity, member: householdMember })
    .from(jobClaim)
    .innerJoin(jobOccurrence, eq(jobClaim.occurrenceId, jobOccurrence.id))
    .innerJoin(earningOpportunity, eq(jobOccurrence.opportunityId, earningOpportunity.id))
    .innerJoin(householdMember, eq(jobClaim.memberId, householdMember.id))
    .where(and(eq(jobClaim.id, claimId), eq(earningOpportunity.householdId, householdId)));
  if (!r) return null;
  const subs = await db
    .select({
      id: jobSubmission.id,
      notes: jobSubmission.notes,
      minutesSpent: jobSubmission.minutesSpent,
      submittedAt: jobSubmission.submittedAt,
      hasPhoto: sql<boolean>`${jobSubmission.photo} IS NOT NULL`,
    })
    .from(jobSubmission)
    .where(eq(jobSubmission.claimId, claimId))
    .orderBy(desc(jobSubmission.submittedAt));
  return { ...r, submissions: subs };
}

/** Everything awaiting a parent decision, in one list. */
export async function approvalsInbox(db: DB, householdId: string) {
  const jobsP = db
    .select({ claim: jobClaim, occ: jobOccurrence, member: householdMember })
    .from(jobClaim)
    .innerJoin(jobOccurrence, eq(jobClaim.occurrenceId, jobOccurrence.id))
    .innerJoin(earningOpportunity, eq(jobOccurrence.opportunityId, earningOpportunity.id))
    .innerJoin(householdMember, eq(jobClaim.memberId, householdMember.id))
    .where(and(eq(earningOpportunity.householdId, householdId), eq(jobClaim.status, "SUBMITTED")))
    .orderBy(jobClaim.updatedAt);
  const proposalsP = db
    .select({ p: childProposal, member: householdMember })
    .from(childProposal)
    .innerJoin(householdMember, eq(childProposal.memberId, householdMember.id))
    .where(and(eq(childProposal.householdId, householdId), eq(childProposal.status, "PENDING")));
  const purchasesP = db
    .select({ p: purchase, member: householdMember })
    .from(purchase)
    .innerJoin(householdMember, eq(purchase.memberId, householdMember.id))
    .where(and(eq(purchase.householdId, householdId), eq(purchase.status, "REQUESTED")));
  const fulfilmentP = db
    .select({ p: purchase, member: householdMember })
    .from(purchase)
    .innerJoin(householdMember, eq(purchase.memberId, householdMember.id))
    .where(and(eq(purchase.householdId, householdId), eq(purchase.status, "AWAITING_FULFILMENT")));
  const cashOutsP = db
    .select({ r: cashOutRequest, member: householdMember })
    .from(cashOutRequest)
    .innerJoin(householdMember, eq(cashOutRequest.memberId, householdMember.id))
    .where(and(eq(cashOutRequest.householdId, householdId), inArray(cashOutRequest.status, ["REQUESTED", "APPROVED"])));
  const adjustmentsP = db
    .select({ a: adjustmentRequest, member: householdMember })
    .from(adjustmentRequest)
    .innerJoin(householdMember, eq(adjustmentRequest.memberId, householdMember.id))
    .where(and(eq(adjustmentRequest.householdId, householdId), eq(adjustmentRequest.status, "PENDING")));
  const disputesP = db
    .select({ d: dispute, member: householdMember })
    .from(dispute)
    .innerJoin(householdMember, eq(dispute.memberId, householdMember.id))
    .where(and(eq(dispute.householdId, householdId), eq(dispute.status, "OPEN")));
  const [jobs, proposals, purchases, fulfilment, cashOuts, adjustments, disputes] = await Promise.all([
    jobsP, proposalsP, purchasesP, fulfilmentP, cashOutsP, adjustmentsP, disputesP,
  ]);
  return { jobs, proposals, purchases, fulfilment, cashOuts, adjustments, disputes };
}

/** Number of items awaiting a parent decision, in a single round trip (used in the nav badge on every page). */
export async function inboxCount(db: DB, householdId: string) {
  const r = await db.execute<{ n: string }>(sql`
    SELECT
      (SELECT COUNT(*) FROM job_claim c JOIN job_occurrence o ON o.id = c.occurrence_id JOIN earning_opportunity e ON e.id = o.opportunity_id
         WHERE e.household_id = ${householdId} AND c.status = 'SUBMITTED')
    + (SELECT COUNT(*) FROM child_proposal WHERE household_id = ${householdId} AND status = 'PENDING')
    + (SELECT COUNT(*) FROM purchase WHERE household_id = ${householdId} AND status IN ('REQUESTED','AWAITING_FULFILMENT'))
    + (SELECT COUNT(*) FROM cash_out_request WHERE household_id = ${householdId} AND status IN ('REQUESTED','APPROVED'))
    + (SELECT COUNT(*) FROM adjustment_request WHERE household_id = ${householdId} AND status = 'PENDING')
    + (SELECT COUNT(*) FROM dispute WHERE household_id = ${householdId} AND status = 'OPEN') AS n
  `);
  return Number(r.rows[0].n);
}

/** Parent dashboard metrics. "Outstanding" is an indicator of commitments, not accounting advice. */
export async function economyOverview(db: DB, householdId: string, tz: string) {
  const s = await getSettings(db, householdId);
  const today = localDate(new Date(), tz);
  const weekStart = startOfLocalDate(startOfWeek(today), tz);
  const monthStart = startOfLocalDate(startOfMonth(today), tz);
  const r = await db.execute<Record<string, string>>(sql`
    SELECT
      (SELECT COALESCE(SUM(points),0) FROM points_ledger_entry WHERE household_id = ${householdId} AND points > 0 AND type <> 'REFUND') AS issued,
      (SELECT COALESCE(SUM(points),0) FROM points_ledger_entry WHERE household_id = ${householdId}) AS outstanding,
      (SELECT COALESCE(-SUM(points),0) FROM points_ledger_entry WHERE household_id = ${householdId} AND type IN ('MARKETPLACE_PURCHASE','SUBSCRIPTION_PAYMENT','REFUND') AND occurred_at >= ${weekStart}) AS spent_week,
      (SELECT COALESCE(SUM(points),0) FROM points_ledger_entry WHERE household_id = ${householdId} AND type IN ('JOB_EARNING','BONUS','MANUAL_AWARD') AND occurred_at >= ${weekStart}) AS earned_week,
      (SELECT COALESCE(SUM(points),0) FROM points_ledger_entry WHERE household_id = ${householdId} AND type IN ('JOB_EARNING','BONUS','MANUAL_AWARD') AND occurred_at >= ${monthStart}) AS earned_month,
      (SELECT COALESCE(SUM(aud_cents),0) FROM cash_out_request WHERE household_id = ${householdId} AND status = 'PAID' AND paid_at >= ${monthStart}) AS payouts_month_cents,
      (SELECT COUNT(*) FROM cash_out_request WHERE household_id = ${householdId} AND status IN ('REQUESTED','APPROVED')) AS payout_requests,
      (SELECT COUNT(*) FROM job_claim c JOIN job_occurrence o ON o.id = c.occurrence_id JOIN earning_opportunity e ON e.id = o.opportunity_id WHERE e.household_id = ${householdId} AND c.status = 'SUBMITTED') AS jobs_awaiting,
      (SELECT COUNT(*) FROM purchase WHERE household_id = ${householdId} AND status = 'AWAITING_FULFILMENT') AS awaiting_fulfilment,
      (SELECT COALESCE(SUM(o.reward_points),0) FROM job_claim c JOIN job_occurrence o ON o.id = c.occurrence_id JOIN earning_opportunity e ON e.id = o.opportunity_id
         WHERE e.household_id = ${householdId} AND c.status IN ('CLAIMED','IN_PROGRESS','SUBMITTED','RETURNED')) AS committed
  `);
  const x = Object.fromEntries(Object.entries(r.rows[0]).map(([k, v]) => [k, Number(v)]));
  return { ...x, centsPerPoint: s.centsPerPoint, weeklyBudget: s.weeklyBudgetPoints, monthlyBudget: s.monthlyBudgetPoints } as {
    issued: number;
    outstanding: number;
    spent_week: number;
    earned_week: number;
    earned_month: number;
    payouts_month_cents: number;
    payout_requests: number;
    jobs_awaiting: number;
    awaiting_fulfilment: number;
    committed: number;
    centsPerPoint: number;
    weeklyBudget: number | null;
    monthlyBudget: number | null;
  };
}

export async function childrenSummary(db: DB, householdId: string) {
  const kids = await children(db, householdId);
  return Promise.all(kids.map(async (k) => ({ member: k, wallet: await wallet(db, k.id) })));
}

export async function memberSubscriptions(db: DB, memberId: string) {
  return db.select().from(subscription).where(eq(subscription.memberId, memberId)).orderBy(desc(subscription.createdAt));
}

export async function householdSubscriptions(db: DB, householdId: string) {
  return db
    .select({ sub: subscription, member: householdMember })
    .from(subscription)
    .innerJoin(householdMember, eq(subscription.memberId, householdMember.id))
    .where(eq(subscription.householdId, householdId))
    .orderBy(subscription.status, subscription.nextDueAt);
}

export async function activeEntitlements(db: DB, memberId: string) {
  return db
    .select()
    .from(entitlement)
    .where(and(eq(entitlement.memberId, memberId), eq(entitlement.status, "ACTIVE"), gte(entitlement.endsAt, new Date())))
    .orderBy(entitlement.endsAt);
}

export async function memberPurchases(db: DB, memberId: string, limit = 100) {
  return db.select().from(purchase).where(eq(purchase.memberId, memberId)).orderBy(desc(purchase.requestedAt)).limit(limit);
}

export async function householdPurchases(db: DB, householdId: string, limit = 200) {
  return db
    .select({ p: purchase, member: householdMember })
    .from(purchase)
    .innerJoin(householdMember, eq(purchase.memberId, householdMember.id))
    .where(eq(purchase.householdId, householdId))
    .orderBy(desc(purchase.requestedAt))
    .limit(limit);
}

export async function memberCashOuts(db: DB, memberId: string) {
  return db.select().from(cashOutRequest).where(eq(cashOutRequest.memberId, memberId)).orderBy(desc(cashOutRequest.requestedAt));
}

export async function memberProposals(db: DB, memberId: string) {
  return db.select().from(childProposal).where(eq(childProposal.memberId, memberId)).orderBy(desc(childProposal.updatedAt));
}

export async function memberDisputes(db: DB, memberId: string) {
  return db.select().from(dispute).where(eq(dispute.memberId, memberId)).orderBy(desc(dispute.createdAt));
}

export async function charterHistory(db: DB, householdId: string) {
  return db.select().from(charterVersion).where(eq(charterVersion.householdId, householdId)).orderBy(desc(charterVersion.version));
}

export async function acknowledgements(db: DB, householdId: string) {
  return db
    .select({ ack: charterAcknowledgement, version: charterVersion.version, member: householdMember })
    .from(charterAcknowledgement)
    .innerJoin(charterVersion, eq(charterAcknowledgement.charterVersionId, charterVersion.id))
    .innerJoin(householdMember, eq(charterAcknowledgement.memberId, householdMember.id))
    .where(eq(charterVersion.householdId, householdId))
    .orderBy(desc(charterAcknowledgement.acknowledgedAt));
}

export async function auditTrail(db: DB, householdId: string, limit = 200, memberId?: string) {
  return db
    .select({ log: auditLog, actorName: householdMember.displayName })
    .from(auditLog)
    .leftJoin(householdMember, eq(auditLog.actorMemberId, householdMember.id))
    .where(
      and(
        eq(auditLog.householdId, householdId),
        ...(memberId ? [or(eq(auditLog.actorMemberId, memberId), eq(auditLog.entityId, memberId))!] : []),
      ),
    )
    .orderBy(desc(auditLog.createdAt))
    .limit(limit);
}

export async function householdLedger(db: DB, householdId: string, limit = 5000) {
  return db
    .select({ e: pointsLedgerEntry, memberName: householdMember.displayName })
    .from(pointsLedgerEntry)
    .innerJoin(householdMember, eq(pointsLedgerEntry.memberId, householdMember.id))
    .where(eq(pointsLedgerEntry.householdId, householdId))
    .orderBy(desc(pointsLedgerEntry.occurredAt))
    .limit(limit);
}

// ─────────────── Reports ───────────────

type Bucket = { label: string; start: string };

function weekBuckets(today: string, n: number): Bucket[] {
  const start = startOfWeek(today);
  return Array.from({ length: n }, (_, i) => {
    const s = addDays(start, -7 * (n - 1 - i));
    return { label: s.slice(5).replace("-", "/"), start: s };
  });
}

function monthBuckets(today: string, n: number): Bucket[] {
  const start = startOfMonth(today);
  return Array.from({ length: n }, (_, i) => {
    const s = addMonths(start, -(n - 1 - i), 1);
    const label = new Date(s + "T00:00:00Z").toLocaleString("en-AU", { month: "short", timeZone: "UTC" });
    return { label, start: s };
  });
}

/** Earned and spent per period, optionally for one member. */
export async function flowSeries(
  db: DB,
  householdId: string,
  tz: string,
  period: "week" | "month",
  n: number,
  memberId?: string,
) {
  const today = localDate(new Date(), tz);
  const buckets = period === "week" ? weekBuckets(today, n) : monthBuckets(today, n);
  const from = startOfLocalDate(buckets[0].start, tz);
  const rows = await db
    .select({ type: pointsLedgerEntry.type, points: pointsLedgerEntry.points, at: pointsLedgerEntry.occurredAt })
    .from(pointsLedgerEntry)
    .where(
      and(
        eq(pointsLedgerEntry.householdId, householdId),
        gte(pointsLedgerEntry.occurredAt, from),
        ...(memberId ? [eq(pointsLedgerEntry.memberId, memberId)] : []),
      ),
    );
  const series = buckets.map((b) => ({ label: b.label, start: b.start, earned: 0, spent: 0, cashed: 0 }));
  for (const r of rows) {
    const d = localDate(r.at, tz);
    let idx = -1;
    for (let i = series.length - 1; i >= 0; i--) {
      if (d >= series[i].start) {
        idx = i;
        break;
      }
    }
    if (idx < 0) continue;
    if (["JOB_EARNING", "BONUS", "MANUAL_AWARD"].includes(r.type)) series[idx].earned += r.points;
    else if (["MARKETPLACE_PURCHASE", "SUBSCRIPTION_PAYMENT", "REFUND"].includes(r.type)) series[idx].spent -= r.points;
    else if (r.type === "CASH_CONVERSION") series[idx].cashed -= r.points;
  }
  return series;
}

export async function byCategory(db: DB, householdId: string, direction: "earned" | "spent", memberId?: string) {
  const types = direction === "earned" ? ["JOB_EARNING"] : ["MARKETPLACE_PURCHASE", "SUBSCRIPTION_PAYMENT", "REFUND"];
  const r = await db.execute<{ category: string | null; points: string }>(sql`
    SELECT COALESCE(category, ${direction === "earned" ? "Uncategorised" : "Other"}) AS category,
           ${direction === "earned" ? sql`SUM(points)` : sql`-SUM(points)`} AS points
    FROM points_ledger_entry
    WHERE household_id = ${householdId} AND type::text IN (${sql.join(types.map((t) => sql`${t}`), sql`, `)})
      ${memberId ? sql`AND member_id = ${memberId}` : sql``}
    GROUP BY 1 HAVING ${direction === "earned" ? sql`SUM(points)` : sql`-SUM(points)`} > 0 ORDER BY 2 DESC
  `);
  return r.rows.map((x) => ({ category: x.category ?? "Other", points: Number(x.points) }));
}

export async function topJobs(db: DB, householdId: string, limit = 8) {
  const r = await db.execute<{ title: string; n: string; points: string }>(sql`
    SELECT e.title, COUNT(*) AS n, COALESCE(SUM(a.points_awarded),0) AS points
    FROM job_claim c JOIN job_occurrence o ON o.id = c.occurrence_id JOIN earning_opportunity e ON e.id = o.opportunity_id
    LEFT JOIN job_approval a ON a.claim_id = c.id AND a.decision IN ('APPROVED','PARTIAL')
    WHERE e.household_id = ${householdId} AND c.status <> 'CANCELLED'
    GROUP BY e.title ORDER BY 2 DESC LIMIT ${limit}
  `);
  return r.rows.map((x) => ({ title: x.title, count: Number(x.n), points: Number(x.points) }));
}

export async function completedJobs(db: DB, memberId: string, limit = 50) {
  return db
    .select({ claim: jobClaim, occ: jobOccurrence })
    .from(jobClaim)
    .innerJoin(jobOccurrence, eq(jobClaim.occurrenceId, jobOccurrence.id))
    .where(and(eq(jobClaim.memberId, memberId), eq(jobClaim.status, "PAID")))
    .orderBy(desc(jobClaim.updatedAt))
    .limit(limit);
}

export async function participationHistory(db: DB, householdId: string, memberId: string) {
  return db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.householdId, householdId), eq(auditLog.entityId, memberId), eq(auditLog.action, "participation.change")))
    .orderBy(desc(auditLog.createdAt));
}

/** Reconcile: compare the ledger sum to the sum of balances shown for every member. */
export async function reconcile(db: DB, householdId: string) {
  const ms = await members(db, householdId, true);
  let total = 0;
  const rows = [];
  for (const m of ms.filter((x) => x.role === "CHILD")) {
    const b = await getBalances(db, m.id);
    total += b.ledger;
    rows.push({ member: m.displayName, ...b });
  }
  const r = await db.execute<{ s: string }>(sql`SELECT COALESCE(SUM(points),0) s FROM points_ledger_entry WHERE household_id = ${householdId}`);
  const ledgerTotal = Number(r.rows[0].s);
  const negative = rows.filter((x) => x.ledger < 0 || x.available < 0);
  return { ok: ledgerTotal === total && negative.length === 0, ledgerTotal, memberTotal: total, rows };
}

export { savingsAllocation, householdMember };
