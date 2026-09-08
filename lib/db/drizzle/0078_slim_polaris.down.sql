-- Down migration for 0078 (WS-26C — generic submission↔domain linkage).
-- Purely additive: one new table, no enum types, no altered columns; the
-- referenced organizations / organization_memberships / form_submissions tables
-- are untouched. Clean reversal: drop the single new table.
DROP TABLE IF EXISTS "form_submission_links";
