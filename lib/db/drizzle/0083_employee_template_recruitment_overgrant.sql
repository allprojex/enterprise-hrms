-- Employee template recruitment over-grant — security correction (2026-09-22).
--
-- The SYSTEM `employee` template carried eight recruitment keys that opened
-- organization-wide recruitment records — and offer WRITE access — to every
-- employee of every organization: requisition.read, vacancy.read,
-- application.read, candidate.read, candidate.notes.read, offer.read,
-- offer.manage and recruitment.reports.read. No employee self-service surface
-- needs any of them (the internal job board is gated by module enablement and
-- membership alone). seed:roles only ever inserts, so removing the keys from
-- roles-permissions-definitions.ts cannot undo grants already written; this
-- migration does.
--
-- DATA ONLY, and deliberately narrow. It removes at most eight mappings: those
-- eight permissions on the role that is simultaneously
--   * a platform template   (organization_id IS NULL),
--   * a system role         (is_system_role = true), and
--   * keyed `employee`.
-- At most one such role can exist (partial unique index
-- roles_system_key_unique), and a role/permission pair is unique
-- (role_permissions_role_permission_unique).
--
-- It does NOT touch: the permission rows themselves; interview.read and
-- scorecard.submit (panel participation, which the service re-verifies); any
-- other template (hr, hr_manager, hr_administrator, org_admin, super_admin keep
-- their recruitment keys); any organization-owned role — including an
-- organization's own copy of the employee template, which is that
-- organization's configuration to correct; membership_roles. No schema object
-- changes, so — like 0036 and 0082 — there is no snapshot for this migration.
--
-- Idempotent: on a database that never held these mappings it deletes nothing.
DELETE FROM "role_permissions" rp
USING "roles" r, "permissions" p
WHERE rp."role_id" = r."id"
  AND rp."permission_id" = p."id"
  AND r."organization_id" IS NULL
  AND r."is_system_role" = true
  AND r."key" = 'employee'
  AND p."key" IN (
    'requisition.read',
    'vacancy.read',
    'application.read',
    'candidate.read',
    'candidate.notes.read',
    'offer.read',
    'offer.manage',
    'recruitment.reports.read'
  );
