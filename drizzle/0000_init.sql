CREATE TYPE "public"."adjustment_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."approval_decision" AS ENUM('APPROVED', 'PARTIAL', 'RETURNED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."billing_frequency" AS ENUM('WEEKLY', 'FORTNIGHTLY', 'MONTHLY');--> statement-breakpoint
CREATE TYPE "public"."billing_status" AS ENUM('PAID', 'FAILED', 'WAIVED');--> statement-breakpoint
CREATE TYPE "public"."cash_out_status" AS ENUM('REQUESTED', 'APPROVED', 'PAID', 'REJECTED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."category_kind" AS ENUM('JOB', 'MARKET');--> statement-breakpoint
CREATE TYPE "public"."claim_status" AS ENUM('CLAIMED', 'IN_PROGRESS', 'SUBMITTED', 'RETURNED', 'APPROVED', 'PAID', 'REJECTED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."difficulty" AS ENUM('EASY', 'MEDIUM', 'HARD');--> statement-breakpoint
CREATE TYPE "public"."dispute_status" AS ENUM('OPEN', 'RESOLVED');--> statement-breakpoint
CREATE TYPE "public"."entitlement_status" AS ENUM('ACTIVE', 'EXPIRED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."fulfilment_type" AS ENUM('NONE', 'MANUAL', 'ENTITLEMENT');--> statement-breakpoint
CREATE TYPE "public"."goal_status" AS ENUM('ACTIVE', 'COMPLETED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."hold_status" AS ENUM('ACTIVE', 'RELEASED', 'CAPTURED');--> statement-breakpoint
CREATE TYPE "public"."ledger_type" AS ENUM('OPENING_BALANCE', 'JOB_EARNING', 'BONUS', 'MANUAL_AWARD', 'MARKETPLACE_PURCHASE', 'SUBSCRIPTION_PAYMENT', 'CASH_CONVERSION', 'REFUND', 'CORRECTION');--> statement-breakpoint
CREATE TYPE "public"."limit_period" AS ENUM('DAY', 'WEEK', 'MONTH', 'EVER');--> statement-breakpoint
CREATE TYPE "public"."occurrence_status" AS ENUM('OPEN', 'CLOSED', 'EXPIRED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."opportunity_kind" AS ENUM('JOB', 'PROJECT');--> statement-breakpoint
CREATE TYPE "public"."opportunity_status" AS ENUM('ACTIVE', 'PAUSED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."participation_status" AS ENUM('ACTIVE', 'PAUSED', 'NOT_PARTICIPATING');--> statement-breakpoint
CREATE TYPE "public"."proposal_status" AS ENUM('PENDING', 'INFO_REQUESTED', 'COUNTERED', 'APPROVED', 'DECLINED', 'WITHDRAWN');--> statement-breakpoint
CREATE TYPE "public"."purchase_status" AS ENUM('REQUESTED', 'APPROVED', 'AWAITING_FULFILMENT', 'FULFILLED', 'REJECTED', 'CANCELLED', 'REFUNDED');--> statement-breakpoint
CREATE TYPE "public"."recurrence" AS ENUM('NONE', 'DAILY', 'WEEKLY', 'FORTNIGHTLY', 'MONTHLY', 'CUSTOM');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('PARENT', 'CHILD');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('ACTIVE', 'GRACE', 'UNPAID', 'PAUSED', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "adjustment_request" (
	"id" text PRIMARY KEY NOT NULL,
	"household_id" text NOT NULL,
	"member_id" text NOT NULL,
	"points" integer NOT NULL,
	"reason" text NOT NULL,
	"reverses_entry_id" text,
	"status" "adjustment_status" DEFAULT 'PENDING' NOT NULL,
	"requested_by_id" text NOT NULL,
	"decided_by_id" text,
	"decided_at" timestamp with time zone,
	"decision_reason" text,
	"ledger_entry_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"household_id" text NOT NULL,
	"actor_member_id" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cash_out_request" (
	"id" text PRIMARY KEY NOT NULL,
	"household_id" text NOT NULL,
	"member_id" text NOT NULL,
	"points" integer NOT NULL,
	"cents_per_point" integer NOT NULL,
	"aud_cents" integer NOT NULL,
	"status" "cash_out_status" DEFAULT 'REQUESTED' NOT NULL,
	"idempotency_key" text NOT NULL,
	"preferred_method" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp with time zone,
	"approved_by_id" text,
	"paid_at" timestamp with time zone,
	"paid_by_id" text,
	"method" text,
	"reference" text,
	"rejected_reason" text,
	"ledger_entry_id" text,
	CONSTRAINT "cash_out_request_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "category" (
	"id" text PRIMARY KEY NOT NULL,
	"household_id" text NOT NULL,
	"kind" "category_kind" NOT NULL,
	"name" text NOT NULL,
	"icon" text DEFAULT '•' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "charter_acknowledgement" (
	"id" text PRIMARY KEY NOT NULL,
	"charter_version_id" text NOT NULL,
	"member_id" text NOT NULL,
	"participation_choice" "participation_status" NOT NULL,
	"acknowledged_at" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "charter_version" (
	"id" text PRIMARY KEY NOT NULL,
	"household_id" text NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"change_summary" text,
	"significant" boolean DEFAULT true NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_by_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "child_proposal" (
	"id" text PRIMARY KEY NOT NULL,
	"household_id" text NOT NULL,
	"member_id" text NOT NULL,
	"title" text NOT NULL,
	"what_to_do" text NOT NULL,
	"beneficiaries" text NOT NULL,
	"estimated_minutes" integer,
	"proposed_points" integer NOT NULL,
	"materials" text,
	"costs" text,
	"value_reason" text NOT NULL,
	"status" "proposal_status" DEFAULT 'PENDING' NOT NULL,
	"counter_points" integer,
	"parent_response" text,
	"child_response" text,
	"decided_by_id" text,
	"opportunity_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dispute" (
	"id" text PRIMARY KEY NOT NULL,
	"household_id" text NOT NULL,
	"member_id" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_ref" text,
	"subject_label" text,
	"explanation" text NOT NULL,
	"status" "dispute_status" DEFAULT 'OPEN' NOT NULL,
	"outcome" text,
	"resolved_by_id" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "earning_opportunity" (
	"id" text PRIMARY KEY NOT NULL,
	"household_id" text NOT NULL,
	"kind" "opportunity_kind" DEFAULT 'JOB' NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category_id" text,
	"reward_points" integer NOT NULL,
	"estimated_minutes" integer,
	"difficulty" "difficulty" DEFAULT 'EASY' NOT NULL,
	"requirements" text,
	"location" text,
	"instructions" text,
	"equipment" text,
	"safety_notes" text,
	"due_at" timestamp with time zone,
	"positions" integer DEFAULT 1 NOT NULL,
	"requires_approval" boolean DEFAULT true NOT NULL,
	"collaborative" boolean DEFAULT false NOT NULL,
	"recurrence" "recurrence" DEFAULT 'NONE' NOT NULL,
	"recurrence_every_days" integer,
	"recurrence_anchor" text,
	"status" "opportunity_status" DEFAULT 'ACTIVE' NOT NULL,
	"restricted_to_member_id" text,
	"proposal_id" text,
	"created_by_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "earning_opportunity_proposal_id_unique" UNIQUE("proposal_id")
);
--> statement-breakpoint
CREATE TABLE "economy_setting" (
	"id" text PRIMARY KEY NOT NULL,
	"household_id" text NOT NULL,
	"cents_per_point" integer DEFAULT 10 NOT NULL,
	"min_cash_out_points" integer DEFAULT 100 NOT NULL,
	"max_cash_out_points" integer,
	"cash_out_methods" text[] DEFAULT ARRAY['Cash','Bank transfer']::text[] NOT NULL,
	"payout_schedule" text DEFAULT 'Payouts are made on Saturdays.' NOT NULL,
	"weekly_budget_points" integer,
	"monthly_budget_points" integer,
	"subscription_grace_days" integer DEFAULT 3 NOT NULL,
	"pause_subscriptions_on_pause" boolean DEFAULT true NOT NULL,
	"corrections_need_second_parent" boolean DEFAULT false NOT NULL,
	"child_requests_enabled" boolean DEFAULT false NOT NULL,
	"reward_guidelines" text DEFAULT 'As a guide, about 100 Points (A$10) per hour of genuinely useful work.' NOT NULL,
	"last_maintenance_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "economy_setting_household_id_unique" UNIQUE("household_id")
);
--> statement-breakpoint
CREATE TABLE "entitlement" (
	"id" text PRIMARY KEY NOT NULL,
	"household_id" text NOT NULL,
	"member_id" text NOT NULL,
	"name" text NOT NULL,
	"purchase_id" text,
	"subscription_id" text,
	"billing_record_id" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" "entitlement_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entitlement_billing_record_id_unique" UNIQUE("billing_record_id")
);
--> statement-breakpoint
CREATE TABLE "household" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"timezone" text DEFAULT 'Australia/Brisbane' NOT NULL,
	"currency" text DEFAULT 'AUD' NOT NULL,
	"activated_at" timestamp with time zone,
	"is_demo" boolean DEFAULT false NOT NULL,
	"next_receipt_number" integer DEFAULT 1001 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "household_member" (
	"id" text PRIMARY KEY NOT NULL,
	"household_id" text NOT NULL,
	"user_id" text NOT NULL,
	"display_name" text NOT NULL,
	"role" "role" NOT NULL,
	"participation_status" "participation_status" DEFAULT 'NOT_PARTICIPATING' NOT NULL,
	"avatar_color" text DEFAULT '#4f46e5' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "household_member_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "job_approval" (
	"id" text PRIMARY KEY NOT NULL,
	"claim_id" text NOT NULL,
	"decision" "approval_decision" NOT NULL,
	"points_awarded" integer DEFAULT 0 NOT NULL,
	"reason" text,
	"decided_by_id" text,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_claim" (
	"id" text PRIMARY KEY NOT NULL,
	"occurrence_id" text NOT NULL,
	"member_id" text NOT NULL,
	"status" "claim_status" DEFAULT 'CLAIMED' NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_occurrence" (
	"id" text PRIMARY KEY NOT NULL,
	"opportunity_id" text NOT NULL,
	"milestone_id" text,
	"period_key" text NOT NULL,
	"title" text NOT NULL,
	"reward_points" integer NOT NULL,
	"available_from" timestamp with time zone DEFAULT now() NOT NULL,
	"due_at" timestamp with time zone,
	"status" "occurrence_status" DEFAULT 'OPEN' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_submission" (
	"id" text PRIMARY KEY NOT NULL,
	"claim_id" text NOT NULL,
	"notes" text,
	"minutes_spent" integer,
	"photo" "bytea",
	"photo_type" text,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_attempt" (
	"id" text PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"ip" text NOT NULL,
	"success" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketplace_item" (
	"id" text PRIMARY KEY NOT NULL,
	"household_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category_id" text,
	"price_points" integer NOT NULL,
	"icon" text DEFAULT '🎁' NOT NULL,
	"image_url" text,
	"available" boolean DEFAULT true NOT NULL,
	"archived_at" timestamp with time zone,
	"per_person_limit" integer,
	"limit_period" "limit_period" DEFAULT 'WEEK' NOT NULL,
	"requires_approval" boolean DEFAULT true NOT NULL,
	"fulfilment_type" "fulfilment_type" DEFAULT 'MANUAL' NOT NULL,
	"entitlement_days" integer,
	"is_subscription" boolean DEFAULT false NOT NULL,
	"billing_frequency" "billing_frequency",
	"refundable" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification" (
	"id" text PRIMARY KEY NOT NULL,
	"household_id" text NOT NULL,
	"member_id" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"link" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "points_hold" (
	"id" text PRIMARY KEY NOT NULL,
	"household_id" text NOT NULL,
	"member_id" text NOT NULL,
	"points" integer NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"description" text NOT NULL,
	"status" "hold_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "points_ledger_entry" (
	"id" text PRIMARY KEY NOT NULL,
	"household_id" text NOT NULL,
	"member_id" text NOT NULL,
	"type" "ledger_type" NOT NULL,
	"points" integer NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"description" text NOT NULL,
	"source_type" text,
	"source_id" text,
	"idempotency_key" text NOT NULL,
	"approved_by_id" text,
	"created_by_id" text,
	"cents_per_point" integer,
	"aud_cents" integer,
	"reverses_entry_id" text,
	"category" text,
	"audit_log_id" text,
	CONSTRAINT "points_ledger_entry_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "points_ledger_entry_reverses_entry_id_unique" UNIQUE("reverses_entry_id")
);
--> statement-breakpoint
CREATE TABLE "project_milestone" (
	"id" text PRIMARY KEY NOT NULL,
	"opportunity_id" text NOT NULL,
	"sort_order" integer NOT NULL,
	"title" text NOT NULL,
	"reward_points" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase" (
	"id" text PRIMARY KEY NOT NULL,
	"household_id" text NOT NULL,
	"member_id" text NOT NULL,
	"item_id" text NOT NULL,
	"item_name" text NOT NULL,
	"price_points" integer NOT NULL,
	"receipt_number" integer NOT NULL,
	"status" "purchase_status" DEFAULT 'REQUESTED' NOT NULL,
	"idempotency_key" text NOT NULL,
	"note" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by_id" text,
	"decision_reason" text,
	"fulfilled_at" timestamp with time zone,
	"fulfilled_by_id" text,
	"refunded_at" timestamp with time zone,
	"refunded_by_id" text,
	"refund_reason" text,
	"ledger_entry_id" text,
	"subscription_id" text,
	CONSTRAINT "purchase_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "savings_allocation" (
	"id" text PRIMARY KEY NOT NULL,
	"goal_id" text NOT NULL,
	"member_id" text NOT NULL,
	"points" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "savings_goal" (
	"id" text PRIMARY KEY NOT NULL,
	"household_id" text NOT NULL,
	"member_id" text NOT NULL,
	"title" text NOT NULL,
	"icon" text DEFAULT '🎯' NOT NULL,
	"target_points" integer NOT NULL,
	"target_date" timestamp with time zone,
	"locked" boolean DEFAULT false NOT NULL,
	"status" "goal_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription" (
	"id" text PRIMARY KEY NOT NULL,
	"household_id" text NOT NULL,
	"member_id" text NOT NULL,
	"item_id" text NOT NULL,
	"name" text NOT NULL,
	"price_points" integer NOT NULL,
	"frequency" "billing_frequency" NOT NULL,
	"start_date" timestamp with time zone NOT NULL,
	"next_due_at" timestamp with time zone NOT NULL,
	"status" "subscription_status" DEFAULT 'ACTIVE' NOT NULL,
	"auto_renew" boolean DEFAULT true NOT NULL,
	"grace_days" integer DEFAULT 3 NOT NULL,
	"grace_until" timestamp with time zone,
	"paused_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription_billing_record" (
	"id" text PRIMARY KEY NOT NULL,
	"subscription_id" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"points" integer NOT NULL,
	"status" "billing_status" NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"ledger_entry_id" text,
	"last_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_billing_record_ledger_entry_id_unique" UNIQUE("ledger_entry_id")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_username_unique" UNIQUE("username")
);
--> statement-breakpoint
ALTER TABLE "adjustment_request" ADD CONSTRAINT "adjustment_request_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adjustment_request" ADD CONSTRAINT "adjustment_request_member_id_household_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."household_member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_out_request" ADD CONSTRAINT "cash_out_request_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_out_request" ADD CONSTRAINT "cash_out_request_member_id_household_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."household_member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category" ADD CONSTRAINT "category_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charter_acknowledgement" ADD CONSTRAINT "charter_acknowledgement_charter_version_id_charter_version_id_fk" FOREIGN KEY ("charter_version_id") REFERENCES "public"."charter_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charter_acknowledgement" ADD CONSTRAINT "charter_acknowledgement_member_id_household_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."household_member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charter_version" ADD CONSTRAINT "charter_version_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "child_proposal" ADD CONSTRAINT "child_proposal_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "child_proposal" ADD CONSTRAINT "child_proposal_member_id_household_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."household_member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispute" ADD CONSTRAINT "dispute_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispute" ADD CONSTRAINT "dispute_member_id_household_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."household_member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "earning_opportunity" ADD CONSTRAINT "earning_opportunity_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "earning_opportunity" ADD CONSTRAINT "earning_opportunity_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "earning_opportunity" ADD CONSTRAINT "earning_opportunity_restricted_to_member_id_household_member_id_fk" FOREIGN KEY ("restricted_to_member_id") REFERENCES "public"."household_member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "earning_opportunity" ADD CONSTRAINT "earning_opportunity_proposal_id_child_proposal_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."child_proposal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "economy_setting" ADD CONSTRAINT "economy_setting_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlement" ADD CONSTRAINT "entitlement_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlement" ADD CONSTRAINT "entitlement_member_id_household_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."household_member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlement" ADD CONSTRAINT "entitlement_purchase_id_purchase_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchase"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlement" ADD CONSTRAINT "entitlement_subscription_id_subscription_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscription"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_member" ADD CONSTRAINT "household_member_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_member" ADD CONSTRAINT "household_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_approval" ADD CONSTRAINT "job_approval_claim_id_job_claim_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."job_claim"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_claim" ADD CONSTRAINT "job_claim_occurrence_id_job_occurrence_id_fk" FOREIGN KEY ("occurrence_id") REFERENCES "public"."job_occurrence"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_claim" ADD CONSTRAINT "job_claim_member_id_household_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."household_member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_occurrence" ADD CONSTRAINT "job_occurrence_opportunity_id_earning_opportunity_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."earning_opportunity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_occurrence" ADD CONSTRAINT "job_occurrence_milestone_id_project_milestone_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."project_milestone"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_submission" ADD CONSTRAINT "job_submission_claim_id_job_claim_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."job_claim"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_item" ADD CONSTRAINT "marketplace_item_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_item" ADD CONSTRAINT "marketplace_item_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_member_id_household_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."household_member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_hold" ADD CONSTRAINT "points_hold_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_hold" ADD CONSTRAINT "points_hold_member_id_household_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."household_member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_ledger_entry" ADD CONSTRAINT "points_ledger_entry_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_ledger_entry" ADD CONSTRAINT "points_ledger_entry_member_id_household_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."household_member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_milestone" ADD CONSTRAINT "project_milestone_opportunity_id_earning_opportunity_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."earning_opportunity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase" ADD CONSTRAINT "purchase_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase" ADD CONSTRAINT "purchase_member_id_household_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."household_member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase" ADD CONSTRAINT "purchase_item_id_marketplace_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."marketplace_item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "savings_allocation" ADD CONSTRAINT "savings_allocation_goal_id_savings_goal_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."savings_goal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "savings_allocation" ADD CONSTRAINT "savings_allocation_member_id_household_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."household_member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "savings_goal" ADD CONSTRAINT "savings_goal_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "savings_goal" ADD CONSTRAINT "savings_goal_member_id_household_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."household_member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_member_id_household_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."household_member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_item_id_marketplace_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."marketplace_item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_billing_record" ADD CONSTRAINT "subscription_billing_record_subscription_id_subscription_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscription"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_household_idx" ON "audit_log" USING btree ("household_id","created_at");--> statement-breakpoint
CREATE INDEX "cash_out_member_idx" ON "cash_out_request" USING btree ("member_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "category_uq" ON "category" USING btree ("household_id","kind","name");--> statement-breakpoint
CREATE UNIQUE INDEX "charter_ack_uq" ON "charter_acknowledgement" USING btree ("charter_version_id","member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "charter_version_uq" ON "charter_version" USING btree ("household_id","version");--> statement-breakpoint
CREATE INDEX "opportunity_household_idx" ON "earning_opportunity" USING btree ("household_id","status");--> statement-breakpoint
CREATE INDEX "entitlement_member_idx" ON "entitlement" USING btree ("member_id","status");--> statement-breakpoint
CREATE INDEX "member_household_idx" ON "household_member" USING btree ("household_id");--> statement-breakpoint
CREATE UNIQUE INDEX "claim_occurrence_member_uq" ON "job_claim" USING btree ("occurrence_id","member_id");--> statement-breakpoint
CREATE INDEX "claim_member_status_idx" ON "job_claim" USING btree ("member_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "occurrence_period_uq" ON "job_occurrence" USING btree ("opportunity_id","period_key");--> statement-breakpoint
CREATE INDEX "occurrence_status_idx" ON "job_occurrence" USING btree ("status");--> statement-breakpoint
CREATE INDEX "login_attempt_user_idx" ON "login_attempt" USING btree ("username","created_at");--> statement-breakpoint
CREATE INDEX "login_attempt_ip_idx" ON "login_attempt" USING btree ("ip","created_at");--> statement-breakpoint
CREATE INDEX "notification_member_idx" ON "notification" USING btree ("member_id","read_at");--> statement-breakpoint
CREATE UNIQUE INDEX "hold_source_uq" ON "points_hold" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE INDEX "hold_member_status_idx" ON "points_hold" USING btree ("member_id","status");--> statement-breakpoint
CREATE INDEX "ledger_household_idx" ON "points_ledger_entry" USING btree ("household_id","occurred_at");--> statement-breakpoint
CREATE INDEX "ledger_member_idx" ON "points_ledger_entry" USING btree ("member_id","occurred_at");--> statement-breakpoint
CREATE INDEX "ledger_source_idx" ON "points_ledger_entry" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_receipt_uq" ON "purchase" USING btree ("household_id","receipt_number");--> statement-breakpoint
CREATE INDEX "purchase_member_idx" ON "purchase" USING btree ("member_id","status");--> statement-breakpoint
CREATE INDEX "allocation_member_idx" ON "savings_allocation" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "goal_member_idx" ON "savings_goal" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "session_user_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "subscription_due_idx" ON "subscription" USING btree ("status","next_due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_period_uq" ON "subscription_billing_record" USING btree ("subscription_id","period_start");