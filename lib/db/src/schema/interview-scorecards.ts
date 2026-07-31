import { pgTable, text, serial, timestamp, integer, pgEnum, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { interviewsTable } from "./interviews";
import { organizationMembershipsTable } from "./organization-memberships";

// Interview Scorecards (Phase 3A, W55 — Interview Scorecards): independent,
// lockable evaluations — one per panel member per interview (docs/PHASE_3A_RECRUITMENT_IMPLEMENTATION_PLAN.md
// §9 `interview_scorecards` row). Column list is exactly that row — no
// weighting, no numeric rollup, no template/criteria table exists anywhere
// in the frozen scope (§23 W55 names only two tables: this one and
// `interview_scorecard_responses`), so none are added here.
//
// Lifecycle (§9's own "draft until submittedAt, immutable after"):
// draft (submittedAt null) -> submitted (submittedAt set, immutable from the
// owning interviewer's side from this point on) -> finalized (finalizedAt
// set, an HR/recruiter-only lock, §7 — never available to the "own" tier).
//
// `externalInterviewerToken`/`externalInterviewerTokenExpiresAt` are
// reserved columns per §9's own key-column list ("interviewerMembershipId`/
// `externalInterviewerToken`") but are not consumed by any route in this
// workstream — §10's literal API list names no public/token-gated scorecard
// route, so external-panel evaluation submission is deferred to a later
// workstream, mirroring vacancies.ts's own `publicId` precedent ("reserved
// ... for a later workstream's public detail route, not consumed by
// anything here").
export const interviewScorecardRecommendationEnum = pgEnum("interview_scorecard_recommendation", ["strong_yes", "yes", "no", "strong_no"]);

export const interviewScorecardsTable = pgTable(
  "interview_scorecards",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    interviewId: integer("interview_id")
      .notNull()
      .references(() => interviewsTable.id, { onDelete: "cascade" }),
    interviewerMembershipId: integer("interviewer_membership_id").references(() => organizationMembershipsTable.id, { onDelete: "set null" }),
    externalInterviewerToken: text("external_interviewer_token"),
    externalInterviewerTokenExpiresAt: timestamp("external_interviewer_token_expires_at", { withTimezone: true }),
    recommendation: interviewScorecardRecommendationEnum("recommendation"),
    overallComment: text("overall_comment"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // Plain (non-partial) unique index — Postgres treats NULL as distinct in
    // unique indexes by default, so several externally-token-based rows
    // (interviewerMembershipId null) can coexist without a `.where()` clause,
    // unlike interview_panel_members' external-name/email case.
    uniqueIndex("interview_scorecards_interview_interviewer_unique").on(table.interviewId, table.interviewerMembershipId),
    index("interview_scorecards_org_idx").on(table.organizationId),
    index("interview_scorecards_interview_idx").on(table.interviewId),
  ],
);

export const insertInterviewScorecardSchema = createInsertSchema(interviewScorecardsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertInterviewScorecard = z.infer<typeof insertInterviewScorecardSchema>;
export type InterviewScorecard = typeof interviewScorecardsTable.$inferSelect;
