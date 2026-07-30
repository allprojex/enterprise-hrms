import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { applicationsTable } from "./applications";
import { recruitmentStagesTable } from "./recruitment-stages";
import { organizationMembershipsTable } from "./organization-memberships";

// Application Stage History (Phase 3A, W51 — Application Pipeline & Stage
// Movement): the immutable log of every stage movement on an application
// (docs/PHASE_3A_RECRUITMENT_IMPLEMENTATION_PLAN.md §4.4/§9) — "the only
// place stage transitions are recorded; the application row always points
// at its current stage only." Append-only: no route or service function
// ever updates or deletes a row here, mirroring `requisition_approvals`'
// and `candidate_consents`' established immutability discipline.
// `fromStageId` is nullable for a genuinely new application's first
// movement — every W49-submitted application starts with
// `applications.currentStageId = null` (stage assignment is pipeline
// logic, explicitly deferred to this workstream). `toStageId` is never
// null: every recorded movement has a real destination. `movedAt` is the
// row's own creation moment, so no separate `createdAt` column is needed
// (mirrors `candidate_consents.consentedAt`'s exact precedent).
export const applicationStageHistoryTable = pgTable(
  "application_stage_history",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    applicationId: integer("application_id")
      .notNull()
      .references(() => applicationsTable.id, { onDelete: "cascade" }),
    fromStageId: integer("from_stage_id").references(() => recruitmentStagesTable.id, { onDelete: "restrict" }),
    toStageId: integer("to_stage_id")
      .notNull()
      .references(() => recruitmentStagesTable.id, { onDelete: "restrict" }),
    movedByMembershipId: integer("moved_by_membership_id").references(() => organizationMembershipsTable.id, {
      onDelete: "set null",
    }),
    reason: text("reason"),
    movedAt: timestamp("moved_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("application_stage_history_org_idx").on(table.organizationId),
    index("application_stage_history_application_idx").on(table.applicationId),
  ],
);

export const insertApplicationStageHistorySchema = createInsertSchema(applicationStageHistoryTable).omit({
  id: true,
});

export type InsertApplicationStageHistory = z.infer<typeof insertApplicationStageHistorySchema>;
export type ApplicationStageHistory = typeof applicationStageHistoryTable.$inferSelect;
