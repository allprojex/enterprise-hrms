import { pgTable, serial, integer, text, boolean, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { applicationsTable } from "./applications";
import { vacancyQuestionsTable } from "./vacancy-questions";

// Application Answers (Phase 3A, W52 — Screening Questions & Scoring): a
// candidate's response to one of the vacancy's screening questions
// (docs/PHASE_3A_RECRUITMENT_IMPLEMENTATION_PLAN.md §9/§12), captured at
// W49's public apply endpoint — this table did not exist when W49 shipped
// (vacancy-questions.ts's own header noted "no application/answer logic
// exists yet — that's a later workstream's application_answers table").
// `knockoutFailed` is computed server-side at submission time against
// `vacancyQuestions.expectedAnswer`, for yes_no/multiple_choice knockout
// questions only (§12) — a failed knockout never auto-rejects the
// application; it only flags this row for recruiter review. Write-once: no
// route or service function updates a row after submission, mirroring
// `candidate_consents`'/`application_stage_history`'s immutability
// discipline (§9 marks this table "on submit" only, no update path).
export const applicationAnswersTable = pgTable(
  "application_answers",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    applicationId: integer("application_id")
      .notNull()
      .references(() => applicationsTable.id, { onDelete: "cascade" }),
    vacancyQuestionId: integer("vacancy_question_id")
      .notNull()
      .references(() => vacancyQuestionsTable.id, { onDelete: "restrict" }),
    answerText: text("answer_text").notNull(),
    knockoutFailed: boolean("knockout_failed").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("application_answers_application_question_unique").on(table.applicationId, table.vacancyQuestionId),
    index("application_answers_org_idx").on(table.organizationId),
    index("application_answers_application_idx").on(table.applicationId),
  ],
);

export const insertApplicationAnswerSchema = createInsertSchema(applicationAnswersTable).omit({
  id: true,
  createdAt: true,
});

export type InsertApplicationAnswer = z.infer<typeof insertApplicationAnswerSchema>;
export type ApplicationAnswer = typeof applicationAnswersTable.$inferSelect;
