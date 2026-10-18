-- Down migration for 0083 (employee template recruitment over-grant correction).
--
-- Restores ONLY the mappings 0083 targets: the eight recruitment keys on the
-- SYSTEM `employee` template (organization_id IS NULL, is_system_role, key
-- 'employee'). Nothing else is inserted, and no organization-owned role,
-- permission row or membership is touched. Idempotent: ON CONFLICT leaves an
-- already-present mapping alone.
--
-- What this restores is the pre-0083 state — the mappings that release's own
-- seed:roles produces. SQL cannot tell whether 0083 actually removed a row, so
-- on a database that was never seeded before 0083 this inserts mappings that
-- were not there before; that is still exactly what a rollback plus its seed
-- would produce.
--
-- BREAK-GLASS ONLY, and only together with an application rollback to a
-- release whose seed definitions still grant these keys. It re-opens
-- organization-wide candidate, application and offer access — including offer
-- WRITE — to every employee of every organization.
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r."organization_id" IS NULL
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
  )
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
