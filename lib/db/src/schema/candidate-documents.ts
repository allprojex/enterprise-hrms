import { pgTable, text, serial, timestamp, integer, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { candidatesTable } from "./candidates";
import { applicationsTable } from "./applications";

// Candidate Documents (Phase 3A, W49 — Public Careers Portal): CV/resume
// uploaded at public application time
// (docs/PHASE_3A_RECRUITMENT_IMPLEMENTATION_PLAN.md §6/§9). Mirrors
// `employee_documents`' shape exactly (`categoryCode` free text, not
// Master-Data-FK-validated, same precedent) — `storageKey` is an
// org-scoped, randomly-generated key via the existing `fileStorage.ts`
// convention (W23), never a client-supplied or guessable path.
// `applicationId` is nullable because a document is always uploaded
// against a specific application in this workstream (no standalone
// profile-document upload exists yet), but the frozen table shape reserves
// the nullable case for a later profile-level upload surface (W50+).
export const candidateDocumentsTable = pgTable(
  "candidate_documents",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    candidateId: integer("candidate_id")
      .notNull()
      .references(() => candidatesTable.id, { onDelete: "cascade" }),
    applicationId: integer("application_id").references(() => applicationsTable.id, { onDelete: "set null" }),
    categoryCode: text("category_code").notNull().default("resume"),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    fileSize: integer("file_size").notNull(),
    storageKey: text("storage_key").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("candidate_documents_org_idx").on(table.organizationId),
    index("candidate_documents_candidate_idx").on(table.candidateId),
    index("candidate_documents_application_idx").on(table.applicationId),
  ],
);

export const insertCandidateDocumentSchema = createInsertSchema(candidateDocumentsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertCandidateDocument = z.infer<typeof insertCandidateDocumentSchema>;
export type CandidateDocument = typeof candidateDocumentsTable.$inferSelect;
