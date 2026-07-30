import { pgTable, text, serial, timestamp, integer, numeric, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { candidatesTable } from "./candidates";
import { vacanciesTable } from "./vacancies";
import { recruitmentStagesTable } from "./recruitment-stages";

// Applications (Phase 3A, W49 — Public Careers Portal): one candidate's
// submission against one vacancy (docs/PHASE_3A_RECRUITMENT_IMPLEMENTATION_PLAN.md
// §3.2/§9). Submission only, per the frozen W49 scope note ("applications
// (submission only)") — no pipeline movement, screening, scoring, or
// rejection/withdrawal exists yet (W51 "Application Pipeline & Stage
// Movement" owns that). `currentStageId` is defined now (matching the
// table's full frozen shape) but always null in this workstream — resolving
// an initial workflow stage is itself pipeline logic, out of scope here; a
// freshly submitted application simply reports "submitted", not a
// stage-category-derived status (§4.4), until W51 starts assigning stages.
// `publicId` is a second, distinct token from the status-check token below —
// a stable, non-expiring public reference (mirrors vacancies.publicId,
// W47), never the row's serial PK, per §6's "no public endpoint accepts or
// enumerates an internal ID" rule.
export const applicationsTable = pgTable(
  "applications",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    candidateId: integer("candidate_id")
      .notNull()
      .references(() => candidatesTable.id, { onDelete: "cascade" }),
    vacancyId: integer("vacancy_id")
      .notNull()
      .references(() => vacanciesTable.id, { onDelete: "restrict" }),
    currentStageId: integer("current_stage_id").references(() => recruitmentStagesTable.id, { onDelete: "set null" }),
    publicId: text("public_id").notNull(),
    source: text("source").notNull().default("careers_portal"),
    rejectionReasonCode: text("rejection_reason_code"),
    withdrawalReasonCode: text("withdrawal_reason_code"),
    score: numeric("score", { precision: 5, scale: 2 }),
    // Separate from publicId — an ephemeral, re-emailable secret for the
    // anonymous (no-account) status-check link (§6), distinct from the
    // permanent public reference above.
    statusCheckToken: text("status_check_token"),
    statusCheckTokenExpiresAt: timestamp("status_check_token_expires_at", { withTimezone: true }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // One application per candidate per vacancy — a genuine repeat
    // submission is idempotent (returns the existing row), never a second
    // insert (§6). Reapplication after a terminal decision is a later
    // workstream's concern once rejection/withdrawal exist to be terminal
    // from.
    uniqueIndex("applications_candidate_vacancy_unique").on(table.candidateId, table.vacancyId),
    uniqueIndex("applications_public_id_unique").on(table.publicId),
    uniqueIndex("applications_status_check_token_unique").on(table.statusCheckToken),
    index("applications_org_idx").on(table.organizationId),
    index("applications_vacancy_idx").on(table.vacancyId),
    index("applications_candidate_idx").on(table.candidateId),
  ],
);

export const insertApplicationSchema = createInsertSchema(applicationsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertApplication = z.infer<typeof insertApplicationSchema>;
export type Application = typeof applicationsTable.$inferSelect;
