-- Rollback for 0001_loving_william_stryker.sql (Organization Configuration
-- Engine: namespace + schemaVersion columns on organization_settings).
--
-- Safe only if every organization still has at most one settings row (i.e.
-- no namespace other than "general" has been written yet). If additional
-- namespaces exist, dropping the namespace column would collapse multiple
-- rows per organization back under one, violating the original single-row
-- unique constraint — back up and reconcile manually first in that case.

DROP INDEX IF EXISTS "organization_settings_org_namespace_unique";
ALTER TABLE "organization_settings" DROP COLUMN "schema_version";
ALTER TABLE "organization_settings" DROP COLUMN "namespace";
CREATE UNIQUE INDEX "organization_settings_org_unique" ON "organization_settings" USING btree ("organization_id");
