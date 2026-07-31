import { pgTable, text, serial, timestamp, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { interviewScorecardsTable } from "./interview-scorecards";

// Interview Scorecard Responses (Phase 3A, W55 — Interview Scorecards):
// per-criterion answers within one scorecard (docs/PHASE_3A_RECRUITMENT_IMPLEMENTATION_PLAN.md
// §9 `interview_scorecard_responses` row) — column list is exactly
// `scorecardId`, `criterion`, `rating`, `comment`; no `weight` column exists
// anywhere in the frozen model, so no weighted-scoring formula is
// implemented. `criterion` is plain free text, not a foreign key into a
// criteria/template table — no such table exists in this frozen scope, so
// criteria are supplied per-submission by each interviewer, not
// organization-configured; no rating scale/range is defined in the frozen
// plan either, so `rating` is kept an unconstrained integer, the same
// unconstrained-numeric posture `application_scores.score` (W52) already
// established for a comparable free-scored field.
//
// "Immutable once scorecard finalized" (§9) — in practice, the single write
// route this workstream builds (`POST .../interviews/:id/scorecards`, which
// replaces the full response set on every draft save) already refuses any
// write once the parent scorecard is submitted, so responses are frozen
// from submission onward in practice; finalize is the formal, HR-only lock
// on top of that.
export const interviewScorecardResponsesTable = pgTable(
  "interview_scorecard_responses",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    scorecardId: integer("scorecard_id")
      .notNull()
      .references(() => interviewScorecardsTable.id, { onDelete: "cascade" }),
    criterion: text("criterion").notNull(),
    rating: integer("rating"),
    comment: text("comment"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("interview_scorecard_responses_org_idx").on(table.organizationId), index("interview_scorecard_responses_scorecard_idx").on(table.scorecardId)],
);

export const insertInterviewScorecardResponseSchema = createInsertSchema(interviewScorecardResponsesTable).omit({ id: true, createdAt: true });
export type InsertInterviewScorecardResponse = z.infer<typeof insertInterviewScorecardResponseSchema>;
export type InterviewScorecardResponse = typeof interviewScorecardResponsesTable.$inferSelect;
