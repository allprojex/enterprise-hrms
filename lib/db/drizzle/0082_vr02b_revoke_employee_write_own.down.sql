-- Down migration for 0082 (VR-02B — employee template authorization correction).
--
-- Restores ONLY the mapping 0082 targets: `vehicle_request.write.own` on the
-- SYSTEM `employee` template (organization_id IS NULL, is_system_role, key
-- 'employee'). Nothing else is inserted, and no organization-owned role,
-- permission row or membership is touched. Idempotent: ON CONFLICT leaves an
-- already-present mapping alone.
--
-- What this restores is the 6764f3e state — the mapping that release's own
-- seed:roles produces. SQL cannot tell whether 0082 actually removed a row, so
-- on a database that was never seeded at 6764f3e this inserts a mapping that
-- was not there before; that is still exactly what a rollback to 6764f3e plus
-- its seed would produce.
--
-- BREAK-GLASS ONLY, and only together with an application rollback to 6764f3e.
-- Never run this while VR-02B's submission code is live: it would let every
-- employee in every organization submit vehicle requests.
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r."organization_id" IS NULL
  AND r."is_system_role" = true
  AND r."key" = 'employee'
  AND p."key" = 'vehicle_request.write.own'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
