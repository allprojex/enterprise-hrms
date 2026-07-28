-- Rollback for 0016_little_jackal.sql (Phase 2B, W32: Leave Types & Policy
-- Engine — adds the `leave_types` and `leave_policies` tables and their
-- enums). Purely additive in the up direction — no existing table or row
-- was touched — so this rollback only drops what it created.

DROP TABLE IF EXISTS "leave_policies";
DROP TABLE IF EXISTS "leave_types";
DROP TYPE IF EXISTS "public"."leave_policy_status";
DROP TYPE IF EXISTS "public"."leave_entitlement_period";
DROP TYPE IF EXISTS "public"."leave_accrual_method";
DROP TYPE IF EXISTS "public"."leave_type_status";
