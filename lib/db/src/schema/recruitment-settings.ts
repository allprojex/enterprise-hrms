import { pgTable, serial, integer, boolean, timestamp, pgEnum, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { recruitmentWorkflowsTable } from "./recruitment-workflows";

// Recruitment Settings (Phase 3A, W44): one validated row per organization,
// how every org configures Recruitment before any requisition or vacancy
// exists. A dedicated table, not the generic Organization Configuration
// Engine's JSON-namespace pattern (W2/W38) — the frozen plan's own
// reasoning (docs/PHASE_3A_RECRUITMENT_IMPLEMENTATION_PLAN.md §3.1): too
// many structured, relational fields (a workflow reference) for the
// generic engine's shape, the same reasoning leave_policies already used
// over Master Data.
export const recruitmentDuplicateCandidatePolicyEnum = pgEnum("recruitment_duplicate_candidate_policy", [
  "allow",
  "flag",
  "block",
]);

export const recruitmentSettingsTable = pgTable(
  "recruitment_settings",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    enabled: boolean("enabled").notNull().default(false),
    internalRecruitmentEnabled: boolean("internal_recruitment_enabled").notNull().default(true),
    externalRecruitmentEnabled: boolean("external_recruitment_enabled").notNull().default(true),
    requireCandidateAccount: boolean("require_candidate_account").notNull().default(false),
    defaultWorkflowId: integer("default_workflow_id").references(() => recruitmentWorkflowsTable.id, {
      onDelete: "set null",
    }),
    candidateDataRetentionMonths: integer("candidate_data_retention_months"),
    reapplicationWaitingDays: integer("reapplication_waiting_days").notNull().default(0),
    duplicateCandidatePolicy: recruitmentDuplicateCandidatePolicyEnum("duplicate_candidate_policy")
      .notNull()
      .default("flag"),
    defaultOfferExpiryDays: integer("default_offer_expiry_days"),
    // Array of Master Data categoryCode strings, mirrors employee_documents'
    // free-text category convention — validated shape only, not against a
    // domain's item list (same precedent as employeeDocuments.categoryCode).
    defaultDocumentRequirements: jsonb("default_document_requirements").notNull().default([]),
    applicationLimitPerCandidate: integer("application_limit_per_candidate"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex("recruitment_settings_org_unique").on(table.organizationId)],
);

export const insertRecruitmentSettingsSchema = createInsertSchema(recruitmentSettingsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertRecruitmentSettings = z.infer<typeof insertRecruitmentSettingsSchema>;
export type RecruitmentSettings = typeof recruitmentSettingsTable.$inferSelect;
