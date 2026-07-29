import { pgTable, text, serial, timestamp, integer, boolean, pgEnum, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { jobRequisitionsTable } from "./job-requisitions";
import { recruitmentWorkflowsTable } from "./recruitment-workflows";
import { usersTable } from "./users";

// Vacancies (Phase 3A — the frozen plan's own W48; this session's W47): the
// postable unit produced from an approved job requisition
// (docs/PHASE_3A_RECRUITMENT_IMPLEMENTATION_PLAN.md §3.2/§9). Internal
// lifecycle only — no public careers surface exists yet, so `publicId` is
// reserved (generated now, mirroring `generateToken()`'s existing convention
// from auth.ts) for a later workstream's public detail route, not consumed
// by anything here.
//
// Status model — a deliberate, transparently-documented simplification of
// the frozen plan's §4.2 model (`draft -> pending_approval (if the org
// requires vacancy-level approval, otherwise skipped) -> scheduled ->
// published -> paused <-> published -> closed -> archived`, plus
// `cancelled` as a terminal exit from any pre-closed state). The frozen
// plan's own `recruitment_settings` field list (§9) has no
// `vacancyApprovalRequired` toggle — only `requisitionApprovalRequired`/
// `offerApprovalRequired` exist — so there is nothing to condition a
// vacancy-level approval step on, the same gap this session's requisition
// approval workstream (requisitionApprovals.ts) already documented for its
// own delegated-approver tier. `pending_approval` is therefore omitted
// entirely. `cancelled` is folded into `closed` — the frozen compact
// workstream entry (§23 W48) and its own API list expose only
// publish/pause/close/archive, no separate cancel action, so `closed` is
// the single terminal exit from any pre-closed state (draft/scheduled/
// published/paused), reached via the one `close` action the API plan
// defines.
export const vacancyStatusEnum = pgEnum("vacancy_status", [
  "draft",
  "scheduled",
  "published",
  "paused",
  "closed",
  "archived",
]);

export const vacancyVisibilityEnum = pgEnum("vacancy_visibility", ["internal", "external", "both"]);

export const vacanciesTable = pgTable(
  "vacancies",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    requisitionId: integer("requisition_id")
      .notNull()
      .references(() => jobRequisitionsTable.id, { onDelete: "restrict" }),
    workflowId: integer("workflow_id").references(() => recruitmentWorkflowsTable.id, { onDelete: "set null" }),
    publicId: text("public_id").notNull(),
    title: text("title").notNull(),
    visibility: vacancyVisibilityEnum("visibility").notNull().default("internal"),
    status: vacancyStatusEnum("status").notNull().default("draft"),
    openingsCount: integer("openings_count").notNull().default(1),
    filledCount: integer("filled_count").notNull().default(0),
    openDate: timestamp("open_date", { withTimezone: true }),
    closeDate: timestamp("close_date", { withTimezone: true }),
    jobDescription: text("job_description"),
    responsibilities: text("responsibilities"),
    requirements: text("requirements"),
    preferredQualifications: text("preferred_qualifications"),
    seoTitle: text("seo_title"),
    seoDescription: text("seo_description"),
    featured: boolean("featured").notNull().default(false),
    createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
    updatedBy: integer("updated_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("vacancies_public_id_unique").on(table.publicId),
    index("vacancies_org_idx").on(table.organizationId),
    index("vacancies_org_status_idx").on(table.organizationId, table.status),
    index("vacancies_requisition_idx").on(table.requisitionId),
  ],
);

export const insertVacancySchema = createInsertSchema(vacanciesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertVacancy = z.infer<typeof insertVacancySchema>;
export type Vacancy = typeof vacanciesTable.$inferSelect;
