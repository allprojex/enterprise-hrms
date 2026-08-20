import { pgTable, serial, integer, text, timestamp, pgEnum, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { learningCoursesTable } from "./learning-courses";
import { employeesTable } from "./employees";

// Learning Course Sessions (Phase 3D, W85 — Learning Foundation): one
// scheduled instance of an instructor-led course
// (docs/PHASE_3D_LEARNING_IMPLEMENTATION_PLAN.md §8.2) — mirrors
// interviews.ts almost exactly. `scheduledAt` is timestamptz, inherently
// timezone-aware; an end time is always derived as scheduledAt +
// durationMinutes, never stored separately (identical to interviews.ts's
// own convention, no separate timezone column). `instructorEmployeeId` is
// the "instructor of record" for learning.review.write's relationship
// dispatch — resolved server-side, never a client-supplied flag (a later
// workstream's job). Per-enrollee session attendance lives on
// learning_enrollments, not here (§8.2's own explicit "not the Attendance
// module" note) — deliberately no "no_show" status here, unlike
// interviews.status. No CRUD/business logic in W85 — schema only.
export const learningSessionStatusEnum = pgEnum("learning_session_status", ["scheduled", "completed", "cancelled"]);

export const learningCourseSessionsTable = pgTable(
  "learning_course_sessions",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    // Restrict, not cascade — a session must remain referenceable by
    // historical enrollments even if the course is later archived.
    courseId: integer("course_id")
      .notNull()
      .references(() => learningCoursesTable.id, { onDelete: "restrict" }),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    location: text("location"),
    meetingLink: text("meeting_link"),
    instructorEmployeeId: integer("instructor_employee_id").references(() => employeesTable.id, { onDelete: "restrict" }),
    // Null = uncapped. Enforced atomically at enrollment time (a later
    // workstream's job) — schema only needs to carry the value here.
    capacity: integer("capacity"),
    status: learningSessionStatusEnum("status").notNull().default("scheduled"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("learning_course_sessions_org_course_idx").on(table.organizationId, table.courseId),
    index("learning_course_sessions_org_instructor_idx").on(table.organizationId, table.instructorEmployeeId),
  ],
);

export const insertLearningCourseSessionSchema = createInsertSchema(learningCourseSessionsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertLearningCourseSession = z.infer<typeof insertLearningCourseSessionSchema>;
export type LearningCourseSession = typeof learningCourseSessionsTable.$inferSelect;
