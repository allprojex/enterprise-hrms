import { pgTable, serial, integer, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { candidatesTable } from "./candidates";

// Candidate Tags (Phase 3A, W53 — Candidate Notes, Tags, and Talent
// Pools): simple free-text labeling
// (docs/PHASE_3A_RECRUITMENT_IMPLEMENTATION_PLAN.md §9) — deliberately a
// plain `text` column, not a Master Data domain or a fixed enum, so tag
// values are never hard-coded; a recruiter types whatever label is useful
// (e.g. "senior", "referral", "bilingual"). Low-sensitivity per §9 (unlike
// candidate_notes) — no dedicated read/write permission pair, gated by the
// general `candidate.read`/`.manage` pair instead (avoids the permission
// explosion §7 explicitly warns against for a resource this simple).
// Add/remove only — a tag is either present or not, there is no "edit" of
// an existing tag row (renaming is remove-then-add).
export const candidateTagsTable = pgTable(
  "candidate_tags",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    candidateId: integer("candidate_id")
      .notNull()
      .references(() => candidatesTable.id, { onDelete: "cascade" }),
    tag: text("tag").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("candidate_tags_candidate_tag_unique").on(table.candidateId, table.tag),
    index("candidate_tags_org_idx").on(table.organizationId),
    index("candidate_tags_candidate_idx").on(table.candidateId),
  ],
);

export const insertCandidateTagSchema = createInsertSchema(candidateTagsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertCandidateTag = z.infer<typeof insertCandidateTagSchema>;
export type CandidateTag = typeof candidateTagsTable.$inferSelect;
