import { pgTable, serial, integer, text, numeric, timestamp, pgEnum, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { applicationsTable } from "./applications";
import { organizationMembershipsTable } from "./organization-memberships";

// Application Scores (Phase 3A, W52 — Screening Questions & Scoring):
// scoring entries (screening/interview/overall aggregate inputs) against an
// application (docs/PHASE_3A_RECRUITMENT_IMPLEMENTATION_PLAN.md §9/§12).
// Append-only — no unique constraint (multiple entries per type are
// expected as different reviewers score independently); no update/delete
// path anywhere. `applications.score` (defined since W49, always null
// until now) is never written to by this table's writes — §12 is explicit
// that it "is a computed, non-authoritative rollup ... recomputed from
// application_scores on read, not trusted as stored state" (the same
// principle leave_balance_entries' ledger already established: a balance
// is reconstructed live, never stored). The rollup is computed in the
// service layer only, exposed as a response field, never persisted here.
export const applicationScoreTypeEnum = pgEnum("application_score_type", ["screening", "interview", "overall"]);

export const applicationScoresTable = pgTable(
  "application_scores",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    applicationId: integer("application_id")
      .notNull()
      .references(() => applicationsTable.id, { onDelete: "cascade" }),
    scoredByMembershipId: integer("scored_by_membership_id").references(() => organizationMembershipsTable.id, {
      onDelete: "set null",
    }),
    scoreType: applicationScoreTypeEnum("score_type").notNull(),
    score: numeric("score", { precision: 5, scale: 2 }).notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("application_scores_org_idx").on(table.organizationId), index("application_scores_application_idx").on(table.applicationId)],
);

export const insertApplicationScoreSchema = createInsertSchema(applicationScoresTable).omit({
  id: true,
  createdAt: true,
});

export type InsertApplicationScore = z.infer<typeof insertApplicationScoreSchema>;
export type ApplicationScore = typeof applicationScoresTable.$inferSelect;
