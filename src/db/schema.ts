/**
 * Family Economy: relational schema (Drizzle ORM / PostgreSQL).
 *
 * Financial truth lives in points_ledger_entry, which is append-only (UPDATE and
 * DELETE are rejected by database triggers; see drizzle/0001_integrity.sql).
 * Balances are always derived:
 *   ledger    = SUM(points_ledger_entry.points)
 *   held      = SUM(points_hold.points WHERE status = 'ACTIVE')
 *   saved     = SUM(savings_allocation.points)
 *   available = ledger - held - saved
 * Every write that can change a member's available Points first takes a row lock
 * on that member (SELECT ... FOR UPDATE) inside a database transaction.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => ts("created_at").notNull().defaultNow();
const updatedAt = () =>
  ts("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

// ───────────────────────────── Enums ─────────────────────────────

export const roleEnum = pgEnum("role", ["PARENT", "CHILD"]);
export const participationEnum = pgEnum("participation_status", [
  "ACTIVE",
  "PAUSED",
  "NOT_PARTICIPATING",
]);
export const categoryKindEnum = pgEnum("category_kind", ["JOB", "MARKET"]);
export const opportunityKindEnum = pgEnum("opportunity_kind", ["JOB", "PROJECT"]);
export const recurrenceEnum = pgEnum("recurrence", [
  "NONE",
  "DAILY",
  "WEEKLY",
  "FORTNIGHTLY",
  "MONTHLY",
  "CUSTOM",
]);
export const difficultyEnum = pgEnum("difficulty", ["EASY", "MEDIUM", "HARD"]);
export const opportunityStatusEnum = pgEnum("opportunity_status", ["ACTIVE", "PAUSED", "ARCHIVED"]);
export const occurrenceStatusEnum = pgEnum("occurrence_status", [
  "OPEN",
  "CLOSED",
  "EXPIRED",
  "CANCELLED",
]);
export const claimStatusEnum = pgEnum("claim_status", [
  "CLAIMED",
  "IN_PROGRESS",
  "SUBMITTED",
  "RETURNED",
  "APPROVED",
  "PAID",
  "REJECTED",
  "CANCELLED",
]);
export const approvalDecisionEnum = pgEnum("approval_decision", [
  "APPROVED",
  "PARTIAL",
  "RETURNED",
  "REJECTED",
]);
export const proposalStatusEnum = pgEnum("proposal_status", [
  "PENDING",
  "INFO_REQUESTED",
  "COUNTERED",
  "APPROVED",
  "DECLINED",
  "WITHDRAWN",
]);
export const ledgerTypeEnum = pgEnum("ledger_type", [
  "OPENING_BALANCE",
  "JOB_EARNING",
  "BONUS",
  "MANUAL_AWARD",
  "MARKETPLACE_PURCHASE",
  "SUBSCRIPTION_PAYMENT",
  "CASH_CONVERSION",
  "REFUND",
  "CORRECTION",
]);
export const holdStatusEnum = pgEnum("hold_status", ["ACTIVE", "RELEASED", "CAPTURED"]);
export const fulfilmentEnum = pgEnum("fulfilment_type", ["NONE", "MANUAL", "ENTITLEMENT"]);
export const billingFrequencyEnum = pgEnum("billing_frequency", ["WEEKLY", "FORTNIGHTLY", "MONTHLY"]);
export const limitPeriodEnum = pgEnum("limit_period", ["DAY", "WEEK", "MONTH", "EVER"]);
export const purchaseStatusEnum = pgEnum("purchase_status", [
  "REQUESTED",
  "APPROVED",
  "AWAITING_FULFILMENT",
  "FULFILLED",
  "REJECTED",
  "CANCELLED",
  "REFUNDED",
]);
export const entitlementStatusEnum = pgEnum("entitlement_status", ["ACTIVE", "EXPIRED", "CANCELLED"]);
export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "ACTIVE",
  "GRACE",
  "UNPAID",
  "PAUSED",
  "CANCELLED",
]);
export const billingStatusEnum = pgEnum("billing_status", ["PAID", "FAILED", "WAIVED"]);
export const cashOutStatusEnum = pgEnum("cash_out_status", [
  "REQUESTED",
  "APPROVED",
  "PAID",
  "REJECTED",
  "CANCELLED",
]);
export const adjustmentStatusEnum = pgEnum("adjustment_status", ["PENDING", "APPROVED", "REJECTED"]);
export const disputeStatusEnum = pgEnum("dispute_status", ["OPEN", "RESOLVED"]);
export const goalStatusEnum = pgEnum("goal_status", ["ACTIVE", "COMPLETED", "ARCHIVED"]);

// ───────────────────────────── Household & people ─────────────────────────────

export const household = pgTable("household", {
  id: id(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull().default("Australia/Brisbane"),
  currency: text("currency").notNull().default("AUD"),
  /** When set, the economy is live and the exchange rate can no longer be lowered. */
  activatedAt: ts("activated_at"),
  isDemo: boolean("is_demo").notNull().default(false),
  nextReceiptNumber: integer("next_receipt_number").notNull().default(1001),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const economySetting = pgTable("economy_setting", {
  id: id(),
  householdId: text("household_id")
    .notNull()
    .unique()
    .references(() => household.id),
  /** Integer AUD cents per Point. 10 means 10 Points = $1.00. Never a float. */
  centsPerPoint: integer("cents_per_point").notNull().default(10),
  minCashOutPoints: integer("min_cash_out_points").notNull().default(100),
  maxCashOutPoints: integer("max_cash_out_points"),
  cashOutMethods: text("cash_out_methods")
    .array()
    .notNull()
    .default(sql`ARRAY['Cash','Bank transfer']::text[]`),
  payoutSchedule: text("payout_schedule").notNull().default("Payouts are made on Saturdays."),
  weeklyBudgetPoints: integer("weekly_budget_points"),
  monthlyBudgetPoints: integer("monthly_budget_points"),
  subscriptionGraceDays: integer("subscription_grace_days").notNull().default(3),
  pauseSubscriptionsOnPause: boolean("pause_subscriptions_on_pause").notNull().default(true),
  /** A debit correction proposed by one parent must be approved by the other. */
  correctionsNeedSecondParent: boolean("corrections_need_second_parent").notNull().default(false),
  /**
   * When false, children are strictly view-only: they cannot claim jobs, propose work,
   * request purchases, cash out or move savings. Parents record everything.
   */
  childRequestsEnabled: boolean("child_requests_enabled").notNull().default(false),
  rewardGuidelines: text("reward_guidelines")
    .notNull()
    .default("As a guide, about 100 Points (A$10) per hour of genuinely useful work."),
  lastMaintenanceAt: ts("last_maintenance_at"),
  updatedAt: updatedAt(),
});

export const user = pgTable("user", {
  id: id(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const session = pgTable(
  "session",
  {
    /** sha256 of the cookie token; the raw token is never stored. */
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    expiresAt: ts("expires_at").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("session_user_idx").on(t.userId)],
);

export const loginAttempt = pgTable(
  "login_attempt",
  {
    id: id(),
    username: text("username").notNull(),
    ip: text("ip").notNull(),
    success: boolean("success").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("login_attempt_user_idx").on(t.username, t.createdAt),
    index("login_attempt_ip_idx").on(t.ip, t.createdAt),
  ],
);

export const householdMember = pgTable(
  "household_member",
  {
    id: id(),
    householdId: text("household_id")
      .notNull()
      .references(() => household.id),
    userId: text("user_id")
      .notNull()
      .unique()
      .references(() => user.id),
    displayName: text("display_name").notNull(),
    role: roleEnum("role").notNull(),
    participationStatus: participationEnum("participation_status").notNull().default("NOT_PARTICIPATING"),
    avatarColor: text("avatar_color").notNull().default("#4f46e5"),
    archivedAt: ts("archived_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("member_household_idx").on(t.householdId)],
);

// ───────────────────────────── Charter ─────────────────────────────

export const charterVersion = pgTable(
  "charter_version",
  {
    id: id(),
    householdId: text("household_id")
      .notNull()
      .references(() => household.id),
    version: integer("version").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    changeSummary: text("change_summary"),
    significant: boolean("significant").notNull().default(true),
    publishedAt: ts("published_at").notNull().defaultNow(),
    publishedById: text("published_by_id").notNull(),
  },
  (t) => [uniqueIndex("charter_version_uq").on(t.householdId, t.version)],
);

export const charterAcknowledgement = pgTable(
  "charter_acknowledgement",
  {
    id: id(),
    charterVersionId: text("charter_version_id")
      .notNull()
      .references(() => charterVersion.id),
    memberId: text("member_id")
      .notNull()
      .references(() => householdMember.id),
    participationChoice: participationEnum("participation_choice").notNull(),
    acknowledgedAt: ts("acknowledged_at").notNull().defaultNow(),
    effectiveAt: ts("effective_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("charter_ack_uq").on(t.charterVersionId, t.memberId)],
);

// ───────────────────────────── Categories ─────────────────────────────

export const category = pgTable(
  "category",
  {
    id: id(),
    householdId: text("household_id")
      .notNull()
      .references(() => household.id),
    kind: categoryKindEnum("kind").notNull(),
    name: text("name").notNull(),
    icon: text("icon").notNull().default("•"),
    sortOrder: integer("sort_order").notNull().default(0),
    archivedAt: ts("archived_at"),
  },
  (t) => [uniqueIndex("category_uq").on(t.householdId, t.kind, t.name)],
);

// ───────────────────────────── Earning ─────────────────────────────

export const childProposal = pgTable("child_proposal", {
  id: id(),
  householdId: text("household_id")
    .notNull()
    .references(() => household.id),
  memberId: text("member_id")
    .notNull()
    .references(() => householdMember.id),
  title: text("title").notNull(),
  whatToDo: text("what_to_do").notNull(),
  beneficiaries: text("beneficiaries").notNull(),
  estimatedMinutes: integer("estimated_minutes"),
  proposedPoints: integer("proposed_points").notNull(),
  materials: text("materials"),
  costs: text("costs"),
  valueReason: text("value_reason").notNull(),
  status: proposalStatusEnum("status").notNull().default("PENDING"),
  counterPoints: integer("counter_points"),
  parentResponse: text("parent_response"),
  childResponse: text("child_response"),
  decidedById: text("decided_by_id"),
  opportunityId: text("opportunity_id"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const earningOpportunity = pgTable(
  "earning_opportunity",
  {
    id: id(),
    householdId: text("household_id")
      .notNull()
      .references(() => household.id),
    kind: opportunityKindEnum("kind").notNull().default("JOB"),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    categoryId: text("category_id").references(() => category.id),
    /** JOB: reward per completion. PROJECT: sum of milestone rewards (informational). */
    rewardPoints: integer("reward_points").notNull(),
    estimatedMinutes: integer("estimated_minutes"),
    difficulty: difficultyEnum("difficulty").notNull().default("EASY"),
    requirements: text("requirements"),
    location: text("location"),
    instructions: text("instructions"),
    equipment: text("equipment"),
    safetyNotes: text("safety_notes"),
    dueAt: ts("due_at"),
    /** How many children may complete each occurrence (each paid the full reward). */
    positions: integer("positions").notNull().default(1),
    requiresApproval: boolean("requires_approval").notNull().default(true),
    /** PROJECT only: may different children complete different milestones? */
    collaborative: boolean("collaborative").notNull().default(false),
    recurrence: recurrenceEnum("recurrence").notNull().default("NONE"),
    recurrenceEveryDays: integer("recurrence_every_days"),
    /** Local date (YYYY-MM-DD) from which recurrence periods are counted. */
    recurrenceAnchor: text("recurrence_anchor"),
    status: opportunityStatusEnum("status").notNull().default("ACTIVE"),
    /** Set for jobs created from a child proposal: only that child can claim. */
    restrictedToMemberId: text("restricted_to_member_id").references(() => householdMember.id),
    proposalId: text("proposal_id")
      .unique()
      .references(() => childProposal.id),
    createdById: text("created_by_id").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("opportunity_household_idx").on(t.householdId, t.status)],
);

export const projectMilestone = pgTable("project_milestone", {
  id: id(),
  opportunityId: text("opportunity_id")
    .notNull()
    .references(() => earningOpportunity.id),
  sortOrder: integer("sort_order").notNull(),
  title: text("title").notNull(),
  rewardPoints: integer("reward_points").notNull(),
});

/**
 * A concrete, claimable instance of an opportunity: a one-off job, one period of a
 * recurring job, or one milestone of a project.
 */
export const jobOccurrence = pgTable(
  "job_occurrence",
  {
    id: id(),
    opportunityId: text("opportunity_id")
      .notNull()
      .references(() => earningOpportunity.id),
    milestoneId: text("milestone_id").references(() => projectMilestone.id),
    /** "once", a local period-start date "2026-11-16", or "m:<milestoneId>". */
    periodKey: text("period_key").notNull(),
    title: text("title").notNull(),
    rewardPoints: integer("reward_points").notNull(),
    availableFrom: ts("available_from").notNull().defaultNow(),
    dueAt: ts("due_at"),
    status: occurrenceStatusEnum("status").notNull().default("OPEN"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("occurrence_period_uq").on(t.opportunityId, t.periodKey),
    index("occurrence_status_idx").on(t.status),
  ],
);

export const jobClaim = pgTable(
  "job_claim",
  {
    id: id(),
    occurrenceId: text("occurrence_id")
      .notNull()
      .references(() => jobOccurrence.id),
    memberId: text("member_id")
      .notNull()
      .references(() => householdMember.id),
    status: claimStatusEnum("status").notNull().default("CLAIMED"),
    claimedAt: ts("claimed_at").notNull().defaultNow(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("claim_occurrence_member_uq").on(t.occurrenceId, t.memberId),
    index("claim_member_status_idx").on(t.memberId, t.status),
  ],
);

export const jobSubmission = pgTable("job_submission", {
  id: id(),
  claimId: text("claim_id")
    .notNull()
    .references(() => jobClaim.id),
  notes: text("notes"),
  minutesSpent: integer("minutes_spent"),
  photo: bytea("photo"),
  photoType: text("photo_type"),
  submittedAt: ts("submitted_at").notNull().defaultNow(),
});

export const jobApproval = pgTable("job_approval", {
  id: id(),
  claimId: text("claim_id")
    .notNull()
    .references(() => jobClaim.id),
  decision: approvalDecisionEnum("decision").notNull(),
  pointsAwarded: integer("points_awarded").notNull().default(0),
  reason: text("reason"),
  /** null = automatic approval for a job configured not to need approval. */
  decidedById: text("decided_by_id"),
  decidedAt: ts("decided_at").notNull().defaultNow(),
});

// ───────────────────────────── Ledger ─────────────────────────────

/** Append-only. UPDATE and DELETE are rejected by database triggers. */
export const pointsLedgerEntry = pgTable(
  "points_ledger_entry",
  {
    id: id(),
    householdId: text("household_id")
      .notNull()
      .references(() => household.id),
    memberId: text("member_id")
      .notNull()
      .references(() => householdMember.id),
    type: ledgerTypeEnum("type").notNull(),
    /** Signed. Credits positive, debits negative, never zero (CHECK constraint). */
    points: integer("points").notNull(),
    occurredAt: ts("occurred_at").notNull().defaultNow(),
    description: text("description").notNull(),
    /** JOB_CLAIM | PURCHASE | SUBSCRIPTION_BILLING | CASH_OUT | ADJUSTMENT | AWARD | REFUND */
    sourceType: text("source_type"),
    sourceId: text("source_id"),
    /** Guarantees exactly-once posting of a business event, e.g. "job:<claimId>". */
    idempotencyKey: text("idempotency_key").notNull().unique(),
    approvedById: text("approved_by_id"),
    createdById: text("created_by_id"),
    /** Rate snapshot; always set for CASH_CONVERSION. */
    centsPerPoint: integer("cents_per_point"),
    /** Cash value snapshot; always set for CASH_CONVERSION. */
    audCents: integer("aud_cents"),
    reversesEntryId: text("reverses_entry_id").unique(),
    category: text("category"),
    auditLogId: text("audit_log_id"),
  },
  (t) => [
    index("ledger_household_idx").on(t.householdId, t.occurredAt),
    index("ledger_member_idx").on(t.memberId, t.occurredAt),
    index("ledger_source_idx").on(t.sourceType, t.sourceId),
  ],
);

export const pointsHold = pgTable(
  "points_hold",
  {
    id: id(),
    householdId: text("household_id")
      .notNull()
      .references(() => household.id),
    memberId: text("member_id")
      .notNull()
      .references(() => householdMember.id),
    points: integer("points").notNull(),
    /** PURCHASE | CASH_OUT | ADJUSTMENT */
    sourceType: text("source_type").notNull(),
    sourceId: text("source_id").notNull(),
    description: text("description").notNull(),
    status: holdStatusEnum("status").notNull().default("ACTIVE"),
    createdAt: createdAt(),
    resolvedAt: ts("resolved_at"),
  },
  (t) => [
    uniqueIndex("hold_source_uq").on(t.sourceType, t.sourceId),
    index("hold_member_status_idx").on(t.memberId, t.status),
  ],
);

/**
 * A parent-initiated correction. Credits post immediately. Debits hold the Points and,
 * if configured, wait for the other parent's approval.
 */
export const adjustmentRequest = pgTable("adjustment_request", {
  id: id(),
  householdId: text("household_id")
    .notNull()
    .references(() => household.id),
  memberId: text("member_id")
    .notNull()
    .references(() => householdMember.id),
  points: integer("points").notNull(),
  reason: text("reason").notNull(),
  reversesEntryId: text("reverses_entry_id"),
  status: adjustmentStatusEnum("status").notNull().default("PENDING"),
  requestedById: text("requested_by_id").notNull(),
  decidedById: text("decided_by_id"),
  decidedAt: ts("decided_at"),
  decisionReason: text("decision_reason"),
  ledgerEntryId: text("ledger_entry_id"),
  createdAt: createdAt(),
});

// ───────────────────────────── Marketplace ─────────────────────────────

export const marketplaceItem = pgTable("marketplace_item", {
  id: id(),
  householdId: text("household_id")
    .notNull()
    .references(() => household.id),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  categoryId: text("category_id").references(() => category.id),
  pricePoints: integer("price_points").notNull(),
  icon: text("icon").notNull().default("🎁"),
  imageUrl: text("image_url"),
  available: boolean("available").notNull().default(true),
  archivedAt: ts("archived_at"),
  perPersonLimit: integer("per_person_limit"),
  limitPeriod: limitPeriodEnum("limit_period").notNull().default("WEEK"),
  requiresApproval: boolean("requires_approval").notNull().default(true),
  fulfilmentType: fulfilmentEnum("fulfilment_type").notNull().default("MANUAL"),
  entitlementDays: integer("entitlement_days"),
  isSubscription: boolean("is_subscription").notNull().default(false),
  billingFrequency: billingFrequencyEnum("billing_frequency"),
  refundable: boolean("refundable").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const purchase = pgTable(
  "purchase",
  {
    id: id(),
    householdId: text("household_id")
      .notNull()
      .references(() => household.id),
    memberId: text("member_id")
      .notNull()
      .references(() => householdMember.id),
    itemId: text("item_id")
      .notNull()
      .references(() => marketplaceItem.id),
    itemName: text("item_name").notNull(),
    pricePoints: integer("price_points").notNull(),
    receiptNumber: integer("receipt_number").notNull(),
    status: purchaseStatusEnum("status").notNull().default("REQUESTED"),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    note: text("note"),
    requestedAt: ts("requested_at").notNull().defaultNow(),
    decidedAt: ts("decided_at"),
    decidedById: text("decided_by_id"),
    decisionReason: text("decision_reason"),
    fulfilledAt: ts("fulfilled_at"),
    fulfilledById: text("fulfilled_by_id"),
    refundedAt: ts("refunded_at"),
    refundedById: text("refunded_by_id"),
    refundReason: text("refund_reason"),
    ledgerEntryId: text("ledger_entry_id"),
    subscriptionId: text("subscription_id"),
  },
  (t) => [
    uniqueIndex("purchase_receipt_uq").on(t.householdId, t.receiptNumber),
    index("purchase_member_idx").on(t.memberId, t.status),
  ],
);

export const subscription = pgTable(
  "subscription",
  {
    id: id(),
    householdId: text("household_id")
      .notNull()
      .references(() => household.id),
    memberId: text("member_id")
      .notNull()
      .references(() => householdMember.id),
    itemId: text("item_id")
      .notNull()
      .references(() => marketplaceItem.id),
    name: text("name").notNull(),
    pricePoints: integer("price_points").notNull(),
    frequency: billingFrequencyEnum("frequency").notNull(),
    startDate: ts("start_date").notNull(),
    /** Start of the next unpaid billing period. */
    nextDueAt: ts("next_due_at").notNull(),
    status: subscriptionStatusEnum("status").notNull().default("ACTIVE"),
    autoRenew: boolean("auto_renew").notNull().default(true),
    graceDays: integer("grace_days").notNull().default(3),
    graceUntil: ts("grace_until"),
    pausedReason: text("paused_reason"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("subscription_due_idx").on(t.status, t.nextDueAt)],
);

export const subscriptionBillingRecord = pgTable(
  "subscription_billing_record",
  {
    id: id(),
    subscriptionId: text("subscription_id")
      .notNull()
      .references(() => subscription.id),
    periodStart: ts("period_start").notNull(),
    periodEnd: ts("period_end").notNull(),
    points: integer("points").notNull(),
    status: billingStatusEnum("status").notNull(),
    attempts: integer("attempts").notNull().default(1),
    ledgerEntryId: text("ledger_entry_id").unique(),
    lastAttemptAt: ts("last_attempt_at").notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("billing_period_uq").on(t.subscriptionId, t.periodStart)],
);

export const entitlement = pgTable(
  "entitlement",
  {
    id: id(),
    householdId: text("household_id")
      .notNull()
      .references(() => household.id),
    memberId: text("member_id")
      .notNull()
      .references(() => householdMember.id),
    name: text("name").notNull(),
    purchaseId: text("purchase_id").references(() => purchase.id),
    subscriptionId: text("subscription_id").references(() => subscription.id),
    billingRecordId: text("billing_record_id").unique(),
    startsAt: ts("starts_at").notNull(),
    endsAt: ts("ends_at").notNull(),
    status: entitlementStatusEnum("status").notNull().default("ACTIVE"),
    createdAt: createdAt(),
  },
  (t) => [index("entitlement_member_idx").on(t.memberId, t.status)],
);

// ───────────────────────────── Cash ─────────────────────────────

export const cashOutRequest = pgTable(
  "cash_out_request",
  {
    id: id(),
    householdId: text("household_id")
      .notNull()
      .references(() => household.id),
    memberId: text("member_id")
      .notNull()
      .references(() => householdMember.id),
    points: integer("points").notNull(),
    centsPerPoint: integer("cents_per_point").notNull(),
    audCents: integer("aud_cents").notNull(),
    status: cashOutStatusEnum("status").notNull().default("REQUESTED"),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    preferredMethod: text("preferred_method"),
    requestedAt: ts("requested_at").notNull().defaultNow(),
    approvedAt: ts("approved_at"),
    approvedById: text("approved_by_id"),
    paidAt: ts("paid_at"),
    paidById: text("paid_by_id"),
    method: text("method"),
    reference: text("reference"),
    rejectedReason: text("rejected_reason"),
    ledgerEntryId: text("ledger_entry_id"),
  },
  (t) => [index("cash_out_member_idx").on(t.memberId, t.status)],
);

// ───────────────────────────── Savings ─────────────────────────────

export const savingsGoal = pgTable(
  "savings_goal",
  {
    id: id(),
    householdId: text("household_id")
      .notNull()
      .references(() => household.id),
    memberId: text("member_id")
      .notNull()
      .references(() => householdMember.id),
    title: text("title").notNull(),
    icon: text("icon").notNull().default("🎯"),
    targetPoints: integer("target_points").notNull(),
    targetDate: ts("target_date"),
    /** An explicitly agreed lock: only a parent can unlock. */
    locked: boolean("locked").notNull().default(false),
    status: goalStatusEnum("status").notNull().default("ACTIVE"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("goal_member_idx").on(t.memberId)],
);

/** Earmark movements. Not income or expenditure; never touches the ledger. */
export const savingsAllocation = pgTable(
  "savings_allocation",
  {
    id: id(),
    goalId: text("goal_id")
      .notNull()
      .references(() => savingsGoal.id),
    memberId: text("member_id")
      .notNull()
      .references(() => householdMember.id),
    points: integer("points").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("allocation_member_idx").on(t.memberId)],
);

// ───────────────────────────── Comms, disputes, audit ─────────────────────────────

export const notification = pgTable(
  "notification",
  {
    id: id(),
    householdId: text("household_id")
      .notNull()
      .references(() => household.id),
    memberId: text("member_id")
      .notNull()
      .references(() => householdMember.id),
    title: text("title").notNull(),
    body: text("body"),
    link: text("link"),
    readAt: ts("read_at"),
    createdAt: createdAt(),
  },
  (t) => [index("notification_member_idx").on(t.memberId, t.readAt)],
);

export const dispute = pgTable("dispute", {
  id: id(),
  householdId: text("household_id")
    .notNull()
    .references(() => household.id),
  memberId: text("member_id")
    .notNull()
    .references(() => householdMember.id),
  /** JOB | PAYMENT | CHARGE | PURCHASE | OTHER */
  subjectType: text("subject_type").notNull(),
  subjectRef: text("subject_ref"),
  subjectLabel: text("subject_label"),
  explanation: text("explanation").notNull(),
  status: disputeStatusEnum("status").notNull().default("OPEN"),
  outcome: text("outcome"),
  resolvedById: text("resolved_by_id"),
  resolvedAt: ts("resolved_at"),
  createdAt: createdAt(),
});

/** Append-only. UPDATE and DELETE are rejected by database triggers. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    householdId: text("household_id")
      .notNull()
      .references(() => household.id),
    actorMemberId: text("actor_member_id"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    details: jsonb("details"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_household_idx").on(t.householdId, t.createdAt)],
);
