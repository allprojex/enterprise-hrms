-- WS-3 (Audit & Sensitive-Data Security Hardening, Owner Decision #16).
--
-- audit_events has always been documented as append-only (see the schema
-- file's own comment), but until now that was enforced only by application
-- discipline — no route/handler issues an UPDATE or DELETE, but nothing in
-- the database itself stopped one from being added by mistake, or from
-- direct DB access. This migration closes that gap with a trigger, not a
-- privilege/role REVOKE.
--
-- Why a trigger rather than REVOKE UPDATE, DELETE ON audit_events FROM
-- <role>: this platform is deployed across shared hosting, dedicated VPS,
-- and customer-owned Postgres instances (docs/DEPLOYMENT_AND_TENANT_
-- ARCHITECTURE.md) — there is no single, portable, guaranteed-to-exist
-- application role name to REVOKE from across every one of those targets,
-- and on a target where the app connects as the table owner (common on a
-- self-hosted VPS) REVOKE would not even apply (an owner always retains
-- privileges unless it revokes them from itself). A BEFORE UPDATE/DELETE
-- trigger fires on the DML operation itself, independent of which role or
-- privilege level is connected, so it protects this table identically on
-- every one of this platform's supported deployment targets.
--
-- Honest limitation, not claimed as absolute: a role with DDL privileges on
-- this table (ALTER TABLE ... DISABLE TRIGGER, or DROP TRIGGER) can still
-- remove this protection. That is a fundamentally different, far more
-- privileged act than the ordinary DML an application bug or a compromised
-- application-level credential could issue — DDL access is not something
-- this platform's own request-handling code ever needs or has reason to
-- use — so this trigger is a real, meaningful barrier against the actual
-- threat model Owner Decision #16 is defending against ("ordinary
-- application code/users cannot silently modify or delete protected audit
-- history"), not a claim of protection against a fully compromised
-- database-owner credential.
--
-- Maintenance boundary (Owner Decision #16, §11): ordinary application
-- mutation is unconditionally blocked. A future, separate, privileged
-- retention/legal-maintenance workstream (not built here — WS-3 explicitly
-- does not implement a purge engine, per Owner Decision #19/§27-28) can
-- extend this function to check a session-local escape hatch
-- (e.g. `current_setting('app.audit_maintenance', true) = 'on'`, set via
-- `SET LOCAL` inside a privileged, audited maintenance transaction only)
-- before raising. No such bypass is wired up anywhere in this application
-- today — there is no route, script, or code path in this workstream that
-- sets it — so the trigger is a hard, unconditional block on every
-- application-issued UPDATE/DELETE against this table as of WS-3.
CREATE OR REPLACE FUNCTION audit_events_prevent_mutation() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only: % is not permitted on this table', TG_OP
    USING HINT = 'Audit history cannot be modified or deleted through ordinary application access.';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER audit_events_no_update
  BEFORE UPDATE ON "audit_events"
  FOR EACH ROW EXECUTE FUNCTION audit_events_prevent_mutation();
--> statement-breakpoint

CREATE TRIGGER audit_events_no_delete
  BEFORE DELETE ON "audit_events"
  FOR EACH ROW EXECUTE FUNCTION audit_events_prevent_mutation();
