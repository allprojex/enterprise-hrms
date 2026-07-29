import { pgTable, text, serial, timestamp, integer, boolean, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";

// Recruitment Workflows (Phase 3A, W44): a named, org-scoped pipeline (e.g.
// "Standard Hiring", "Volunteer Onboarding"). No execution happens here —
// this table only defines the workflow itself; its ordered stages live in
// recruitment-stages.ts, and no requisition/vacancy/application references
// either table yet (that begins with a later workstream). Mirrors
// leave-types.ts's org-scoped archive lifecycle shape (`isActive` here is
// the equivalent of that table's `status` enum, since "isDefault" already
// needs its own dedicated boolean and a second enum felt redundant).
export const recruitmentWorkflowsTable = pgTable(
  "recruitment_workflows",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    description: text("description"),
    isActive: boolean("is_active").notNull().default(true),
    isDefault: boolean("is_default").notNull().default(false),
    displayOrder: integer("display_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("recruitment_workflows_org_name_unique").on(table.organizationId, table.name),
    // At most one default workflow per organization — enforced at the
    // database level (a partial unique index, same technique
    // leave_balance_entries/master_data_items already use) rather than
    // relying solely on the service layer to keep the invariant true.
    uniqueIndex("recruitment_workflows_org_default_unique")
      .on(table.organizationId)
      .where(sql`${table.isDefault} = true`),
    index("recruitment_workflows_org_idx").on(table.organizationId),
  ],
);

export const insertRecruitmentWorkflowSchema = createInsertSchema(recruitmentWorkflowsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertRecruitmentWorkflow = z.infer<typeof insertRecruitmentWorkflowSchema>;
export type RecruitmentWorkflow = typeof recruitmentWorkflowsTable.$inferSelect;
