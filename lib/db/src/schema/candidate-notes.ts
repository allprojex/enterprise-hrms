import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { candidatesTable } from "./candidates";
import { applicationsTable } from "./applications";
import { organizationMembershipsTable } from "./organization-memberships";

// Candidate Notes (Phase 3A, W53 — Candidate Notes, Tags, and Talent
// Pools): free-text recruiter notes
// (docs/PHASE_3A_RECRUITMENT_IMPLEMENTATION_PLAN.md §9). `applicationId` is
// nullable and is exactly how the frozen plan distinguishes a
// candidate-level note (general, no application) from an
// application-level note (about one specific application) — both live in
// this one table, not two. Create-only: §9 marks this table "on write"
// only (no update path listed), mirroring `candidate_consents`'/
// `application_scores`' append-only precedent already established this
// phase — a correction is a new note, never an edit of a past one. Never
// exposed to an applicant — no candidate-session read path exists anywhere
// in this codebase (W50 deferred), and internal access is gated by the new
// `candidate.notes.read`/`.write` permissions.
export const candidateNotesTable = pgTable(
  "candidate_notes",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    candidateId: integer("candidate_id")
      .notNull()
      .references(() => candidatesTable.id, { onDelete: "cascade" }),
    applicationId: integer("application_id").references(() => applicationsTable.id, { onDelete: "set null" }),
    authorMembershipId: integer("author_membership_id").references(() => organizationMembershipsTable.id, {
      onDelete: "set null",
    }),
    note: text("note").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("candidate_notes_org_idx").on(table.organizationId), index("candidate_notes_candidate_idx").on(table.candidateId)],
);

export const insertCandidateNoteSchema = createInsertSchema(candidateNotesTable).omit({
  id: true,
  createdAt: true,
});

export type InsertCandidateNote = z.infer<typeof insertCandidateNoteSchema>;
export type CandidateNote = typeof candidateNotesTable.$inferSelect;
