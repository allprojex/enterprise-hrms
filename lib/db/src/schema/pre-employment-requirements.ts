import { pgTable, text, serial, timestamp, integer, pgEnum, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { applicationsTable } from "./applications";

// Pre-Employment Requirements (Phase 3A, W58 — Pre-Employment
// Requirements): a checklist tracked against an application before
// convert-to-employee (docs/PHASE_3A_RECRUITMENT_IMPLEMENTATION_PLAN.md
// §9/§13). Column list is exactly §9's own row —
// `applicationId`/`requirementCode`/`status`/`satisfiedAt`/`notes` — no
// document/storageKey column exists in the frozen model at all, so this
// workstream deliberately builds no document-upload mechanism (see
// lib/preEmploymentRequirements.ts's own header for the full reasoning).
// `requirementCode` is a Master Data reference per §9's own text (e.g.
// right-to-work doc, medical, reference-complete) — free text, not FK-
// validated against master_data_items, mirroring
// candidate-documents.ts's own `categoryCode` precedent exactly (same
// "Master Data, not Master-Data-FK-validated" convention).
//
// Status derivation is explicitly "n/a" in §9's own table (unlike e.g.
// reference_checks, which cites §4.7's lifecycle) — there is no frozen
// one-way transition diagram for this resource, so status is freely
// settable between pending/satisfied/waived (a checklist correction, e.g.
// reverting a mistaken "satisfied" back to "pending", is not
// forbidden) — a deliberate difference from reference_checks'/
// background_checks' terminal-once-decided immutability.
export const preEmploymentRequirementStatusEnum = pgEnum("pre_employment_requirement_status", ["pending", "satisfied", "waived"]);

export const preEmploymentRequirementsTable = pgTable(
  "pre_employment_requirements",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    applicationId: integer("application_id")
      .notNull()
      .references(() => applicationsTable.id, { onDelete: "cascade" }),
    requirementCode: text("requirement_code").notNull(),
    status: preEmploymentRequirementStatusEnum("status").notNull().default("pending"),
    satisfiedAt: timestamp("satisfied_at", { withTimezone: true }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("pre_employment_requirements_application_code_unique").on(table.applicationId, table.requirementCode),
    index("pre_employment_requirements_org_idx").on(table.organizationId),
    index("pre_employment_requirements_application_idx").on(table.applicationId),
  ],
);

export const insertPreEmploymentRequirementSchema = createInsertSchema(preEmploymentRequirementsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertPreEmploymentRequirement = z.infer<typeof insertPreEmploymentRequirementSchema>;
export type PreEmploymentRequirement = typeof preEmploymentRequirementsTable.$inferSelect;
