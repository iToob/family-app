-- Financial integrity guarantees enforced by the database itself, independent of
-- application code.

-- 1. Append-only ledger and audit log -------------------------------------------
CREATE OR REPLACE FUNCTION fe_reject_modification() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not permitted', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER points_ledger_entry_no_update BEFORE UPDATE OR DELETE ON points_ledger_entry
  FOR EACH ROW EXECUTE FUNCTION fe_reject_modification();
--> statement-breakpoint
CREATE TRIGGER points_ledger_entry_no_truncate BEFORE TRUNCATE ON points_ledger_entry
  FOR EACH STATEMENT EXECUTE FUNCTION fe_reject_modification();
--> statement-breakpoint
CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION fe_reject_modification();
--> statement-breakpoint
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION fe_reject_modification();
--> statement-breakpoint

-- 2. A member's ledger balance can never go negative ------------------------------
CREATE OR REPLACE FUNCTION fe_check_non_negative_balance() RETURNS trigger AS $$
DECLARE
  bal bigint;
BEGIN
  SELECT COALESCE(SUM(points), 0) INTO bal FROM points_ledger_entry WHERE member_id = NEW.member_id;
  IF bal < 0 THEN
    RAISE EXCEPTION 'Ledger balance for member % would be negative (%)', NEW.member_id, bal
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER points_ledger_entry_non_negative AFTER INSERT ON points_ledger_entry
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW EXECUTE FUNCTION fe_check_non_negative_balance();
--> statement-breakpoint

-- 3. Value checks -----------------------------------------------------------------
ALTER TABLE points_ledger_entry ADD CONSTRAINT ledger_points_nonzero CHECK (points <> 0);
--> statement-breakpoint
ALTER TABLE points_ledger_entry ADD CONSTRAINT ledger_cash_snapshot CHECK (
  type <> 'CASH_CONVERSION' OR (cents_per_point IS NOT NULL AND aud_cents IS NOT NULL AND aud_cents = -points * cents_per_point)
);
--> statement-breakpoint
ALTER TABLE points_hold ADD CONSTRAINT hold_points_positive CHECK (points > 0);
--> statement-breakpoint
ALTER TABLE cash_out_request ADD CONSTRAINT cash_out_positive CHECK (points > 0 AND cents_per_point > 0);
--> statement-breakpoint
ALTER TABLE cash_out_request ADD CONSTRAINT cash_out_amount_exact CHECK (aud_cents = points * cents_per_point);
--> statement-breakpoint
ALTER TABLE economy_setting ADD CONSTRAINT rate_positive CHECK (cents_per_point > 0);
--> statement-breakpoint
ALTER TABLE marketplace_item ADD CONSTRAINT item_price_non_negative CHECK (price_points >= 0);
--> statement-breakpoint
ALTER TABLE purchase ADD CONSTRAINT purchase_price_non_negative CHECK (price_points >= 0);
--> statement-breakpoint
ALTER TABLE earning_opportunity ADD CONSTRAINT opportunity_reward_non_negative CHECK (reward_points >= 0 AND positions >= 1);
--> statement-breakpoint
ALTER TABLE job_occurrence ADD CONSTRAINT occurrence_reward_non_negative CHECK (reward_points >= 0);
--> statement-breakpoint
ALTER TABLE job_approval ADD CONSTRAINT approval_points_non_negative CHECK (points_awarded >= 0);
--> statement-breakpoint
ALTER TABLE savings_goal ADD CONSTRAINT goal_target_positive CHECK (target_points > 0);
--> statement-breakpoint
ALTER TABLE subscription ADD CONSTRAINT subscription_price_positive CHECK (price_points > 0);
--> statement-breakpoint

-- 4. One live subscription per member per item --------------------------------------
CREATE UNIQUE INDEX subscription_live_uq ON subscription (member_id, item_id) WHERE status <> 'CANCELLED';
