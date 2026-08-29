import { pgTable, serial, integer, text, pgEnum, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { employeesTable } from "./employees";
import { usersTable } from "./users";

/**
 * WS-12 (§28.11) — the minimum confidentiality dimension Employee Relations
 * evidence needs, added to the EXISTING document store rather than beside it.
 * No second document subsystem exists, and none may be built.
 *
 * ADDITIVE AND BACKWARD COMPATIBLE. It defaults to `normal`, so every document
 * written before WS-12 and every document written by a caller that has never
 * heard of this column behaves exactly as it did: unchanged storage, unchanged
 * permissions, unchanged reads. Nothing is migrated or re-gated.
 *
 *   normal       — ordinary HR documents. Existing behaviour, unchanged.
 *   confidential — restricted to callers holding the owning domain's permission.
 *   restricted   — the narrowest tier, used for disciplinary and grievance
 *                  evidence. Reads of these go through OD #18's sensitive-read
 *                  audit path (§28.12).
 */
export const documentConfidentialityEnum = pgEnum("document_confidentiality", [
  "normal",
  "confidential",
  "restricted",
]);

// Employee Documents (Phase 2A, W23). One row per stored file — re-uploading
// does not version a prior row, it creates a new one; removing deletes both
// the row and the underlying stored file (see deleteOrgFile in
// artifacts/api-server/src/lib/fileStorage.ts). `categoryCode` is a free-text
// code from the "document_category" Master Data domain (W7,
// organization-defined), same precedent as employees.separationReason — not
// validated against the domain's item list, since that precedent didn't
// either. `storageKey` is the opaque key from writeOrgFile, never derived
// from `fileName` (which is display-only, client-supplied, and never used to
// build a filesystem path).
//
// `employeeId` is nullable as of Phase 3E W95 (Asset Management) — an
// organization-owned document (e.g. an asset's purchase receipt/warranty)
// has no natural single-employee owner the way every pre-existing consumer
// of this table (Core HR's own employee documents, Performance's review
// evidence, Learning's enrollment evidence) does. Every existing consumer
// continues to always supply a real employeeId unchanged; this relaxation
// only newly permits `asset_evidence` (see learning-enrollment-evidence.ts's
// own sibling, asset-evidence.ts) to attach an organization-scoped,
// no-employee document. Approved explicitly during W95 rather than
// improvised — see docs/PHASE_3E_ASSETS_IMPLEMENTATION_PLAN.md's own
// document-ownership reconciliation.
export const employeeDocumentsTable = pgTable(
  "employee_documents",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    employeeId: integer("employee_id").references(() => employeesTable.id, { onDelete: "cascade" }),
    categoryCode: text("category_code").notNull(),
    fileName: text("file_name").notNull(),
    storageKey: text("storage_key").notNull(),
    mimeType: text("mime_type").notNull(),
    fileSize: integer("file_size").notNull(),
    uploadedBy: integer("uploaded_by").references(() => usersTable.id, { onDelete: "set null" }),
    /** WS-12 (§28.11). Defaults to `normal` so pre-WS-12 behaviour is unchanged. */
    confidentiality: documentConfidentialityEnum("confidentiality").notNull().default("normal"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("employee_documents_org_employee_idx").on(table.organizationId, table.employeeId)],
);

export const insertEmployeeDocumentSchema = createInsertSchema(employeeDocumentsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertEmployeeDocument = z.infer<typeof insertEmployeeDocumentSchema>;
export type EmployeeDocument = typeof employeeDocumentsTable.$inferSelect;
