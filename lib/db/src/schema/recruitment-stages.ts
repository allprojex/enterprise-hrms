import { pgTable, text, serial, timestamp, integer, boolean, pgEnum, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { recruitmentWorkflowsTable } from "./recruitment-workflows";

// Recruitment Stages (Phase 3A, W44): ordered stages within a workflow. No
// candidate movement happens here — this is definition only. `category` is
// the fixed, system-owned classification the frozen plan's stage-category
// model requires (docs/PHASE_3A_RECRUITMENT_IMPLEMENTATION_PLAN.md §4.3):
// an organization can rename/reorder/add/remove stages freely, but every
// stage must map to one of these categories so later workstreams' logic
// (e.g. "is this candidate hired") never depends on an organization's own
// stage label. `organizationId` is denormalized here (not derived solely via
// `workflowId`) — the same convention every nested org-scoped table in this
// codebase already follows (e.g. leave_policies carries both organizationId
// and leaveTypeId).
export const recruitmentStageCategoryEnum = pgEnum("recruitment_stage_category", [
  "applied",
  "screening",
  "interview",
  "assessment",
  "offer",
  "hired",
  "rejected",
  "withdrawn",
]);

export const recruitmentStagesTable = pgTable(
  "recruitment_stages",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    workflowId: integer("workflow_id")
      .notNull()
      .references(() => recruitmentWorkflowsTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    category: recruitmentStageCategoryEnum("category").notNull(),
    displayOrder: integer("display_order").notNull().default(0),
    color: text("color"),
    icon: text("icon"),
    isRequired: boolean("is_required").notNull().default(false),
    // A convenience flag mirroring the stage's category (hired/rejected/
    // withdrawn are the frozen plan's terminal categories) rather than
    // requiring every reader to know the category list — validated against
    // category server-side, not independently settable to a contradictory
    // value.
    isTerminal: boolean("is_terminal").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("recruitment_stages_workflow_order_unique").on(table.workflowId, table.displayOrder),
    uniqueIndex("recruitment_stages_workflow_name_unique").on(table.workflowId, table.name),
    index("recruitment_stages_org_idx").on(table.organizationId),
    index("recruitment_stages_workflow_idx").on(table.workflowId),
  ],
);

export const insertRecruitmentStageSchema = createInsertSchema(recruitmentStagesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertRecruitmentStage = z.infer<typeof insertRecruitmentStageSchema>;
export type RecruitmentStage = typeof recruitmentStagesTable.$inferSelect;
