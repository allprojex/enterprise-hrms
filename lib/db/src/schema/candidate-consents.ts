import { pgTable, text, serial, timestamp, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { candidatesTable } from "./candidates";

// Candidate Consents (Phase 3A, W49 — Public Careers Portal): an immutable
// consent record captured at the moment of a public application submission
// (docs/PHASE_3A_RECRUITMENT_IMPLEMENTATION_PLAN.md §6/§9) — first-class,
// not an afterthought, and never re-interpreted against a later privacy-
// notice version (Historical Consistency, the same principle W34's ledger
// already established). Append-only: no route or service function ever
// updates or deletes a row here. `consentedAt` is the row's own creation
// moment — no separate `createdAt` column, since this row's existence *is*
// the audit record (mirrors `candidate_consents`' frozen description: "is
// the audit").
export const candidateConsentsTable = pgTable(
  "candidate_consents",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    candidateId: integer("candidate_id")
      .notNull()
      .references(() => candidatesTable.id, { onDelete: "cascade" }),
    privacyNoticeVersion: text("privacy_notice_version").notNull(),
    consentText: text("consent_text").notNull(),
    consentedAt: timestamp("consented_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("candidate_consents_org_idx").on(table.organizationId), index("candidate_consents_candidate_idx").on(table.candidateId)],
);

export const insertCandidateConsentSchema = createInsertSchema(candidateConsentsTable).omit({
  id: true,
});

export type InsertCandidateConsent = z.infer<typeof insertCandidateConsentSchema>;
export type CandidateConsent = typeof candidateConsentsTable.$inferSelect;
