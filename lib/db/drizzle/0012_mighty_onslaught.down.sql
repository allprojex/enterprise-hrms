-- Rollback for 0012_mighty_onslaught.sql (Phase 2A, W23: Employee Documents —
-- adds the `employee_documents` table). Purely additive in the up
-- direction — no existing table or row was touched — so this rollback only
-- drops what it created. Does not remove any files already written to
-- UPLOADS_DIR/organizations/<id>/documents/ — those are outside the
-- database and unaffected by this migration either way.

DROP TABLE IF EXISTS "employee_documents";
