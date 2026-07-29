import { pgTable, serial, timestamp, integer, text, boolean, pgEnum, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { vacanciesTable } from "./vacancies";

// Vacancy Questions (Phase 3A, W48 in the frozen plan's own numbering —
// this session's W47): screening questions attached to a vacancy
// (docs/PHASE_3A_RECRUITMENT_IMPLEMENTATION_PLAN.md §9). Definition only —
// no application/answer logic exists yet (that's a later workstream's
// application_answers table). `organizationId` is denormalized here,
// mirroring recruitment_stages.ts's established convention.
export const vacancyQuestionTypeEnum = pgEnum("vacancy_question_type", [
  "text",
  "yes_no",
  "multiple_choice",
  "numeric",
]);

export const vacancyQuestionsTable = pgTable(
  "vacancy_questions",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    vacancyId: integer("vacancy_id")
      .notNull()
      .references(() => vacanciesTable.id, { onDelete: "cascade" }),
    questionText: text("question_text").notNull(),
    questionType: vacancyQuestionTypeEnum("question_type").notNull().default("text"),
    isKnockout: boolean("is_knockout").notNull().default(false),
    // Nullable — only meaningful for knockout auto-scoring (§9); free-text
    // and non-knockout questions leave this unset.
    expectedAnswer: text("expected_answer"),
    displayOrder: integer("display_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("vacancy_questions_vacancy_order_unique").on(table.vacancyId, table.displayOrder),
    index("vacancy_questions_org_idx").on(table.organizationId),
    index("vacancy_questions_vacancy_idx").on(table.vacancyId),
  ],
);

export const insertVacancyQuestionSchema = createInsertSchema(vacancyQuestionsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertVacancyQuestion = z.infer<typeof insertVacancyQuestionSchema>;
export type VacancyQuestion = typeof vacancyQuestionsTable.$inferSelect;
