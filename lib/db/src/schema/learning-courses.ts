import { pgTable, serial, integer, text, boolean, timestamp, pgEnum, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { usersTable } from "./users";

// Learning Courses (Phase 3D, W85 — Learning Foundation): the organization-
// owned catalog entry (docs/PHASE_3D_LEARNING_IMPLEMENTATION_PLAN.md §8.1).
// `categoryCode` is a free-text code from the new "training_category"
// Master Data domain (Owner Decision 7) — not validated against the
// domain's item list, same precedent as employeeDocuments.categoryCode.
// Every course-level configuration relevant to an individual enrollment
// (mandatory default, approval requirement, assessment requirement,
// certificate eligibility/validity) is snapshotted onto
// learning_enrollments at creation (§9) — this table is never re-read for
// business-rule evaluation once an enrollment exists. No CRUD/business
// logic in W85 — schema only.
export const learningCourseDeliveryModeEnum = pgEnum("learning_course_delivery_mode", ["self_paced", "instructor_led"]);
export const learningCourseStatusEnum = pgEnum("learning_course_status", ["draft", "active", "archived"]);

export const learningCoursesTable = pgTable(
  "learning_courses",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    categoryCode: text("category_code").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    deliveryMode: learningCourseDeliveryModeEnum("delivery_mode").notNull(),
    mandatoryDefault: boolean("mandatory_default").notNull().default(false),
    requiresApproval: boolean("requires_approval").notNull().default(false),
    hasAssessment: boolean("has_assessment").notNull().default(false),
    issuesCertificate: boolean("issues_certificate").notNull().default(false),
    // Only meaningful when issuesCertificate = true; null = certificate never expires.
    certificateValidityMonths: integer("certificate_validity_months"),
    status: learningCourseStatusEnum("status").notNull().default("draft"),
    createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("learning_courses_org_status_idx").on(table.organizationId, table.status)],
);

export const insertLearningCourseSchema = createInsertSchema(learningCoursesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertLearningCourse = z.infer<typeof insertLearningCourseSchema>;
export type LearningCourse = typeof learningCoursesTable.$inferSelect;
