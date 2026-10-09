-- VR-02B — authorization correction (owner decision, 2026-09-21).
--
-- Vehicle Request submission is an explicit, organization-controlled grant.
-- VR-02A's seed attached `vehicle_request.write.own` to the SYSTEM `employee`
-- template, which would let every employee in every organization submit a
-- request the moment VR-02B's submission route exists. seed:roles only ever
-- inserts, so removing the key from roles-permissions-definitions.ts cannot
-- undo a grant it has already written; this migration does.
--
-- DATA ONLY, and deliberately narrow. It removes exactly one mapping: the
-- permission `vehicle_request.write.own` on the role that is simultaneously
--   * a platform template   (organization_id IS NULL),
--   * a system role         (is_system_role = true), and
--   * keyed `employee`.
-- At most one such role can exist (partial unique index
-- roles_system_key_unique), and a role/permission pair is unique
-- (role_permissions_role_permission_unique), so at most one row is deleted.
--
-- It does NOT touch: the permission row itself; super_admin (which keeps all
-- four vehicle_request.* keys); any organization-owned role, including a
-- tenant's own copy of the employee template and any role an organization used
-- to grant this key on purpose; membership_roles. No schema object changes, so
-- — like 0036 — there is no snapshot for this migration.
--
-- Idempotent: on a database that never held the mapping (fresh install, CI)
-- it deletes nothing.
DELETE FROM "role_permissions" rp
USING "roles" r, "permissions" p
WHERE rp."role_id" = r."id"
  AND rp."permission_id" = p."id"
  AND r."organization_id" IS NULL
  AND r."is_system_role" = true
  AND r."key" = 'employee'
  AND p."key" = 'vehicle_request.write.own';
