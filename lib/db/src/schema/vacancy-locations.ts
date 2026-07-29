import { pgTable, serial, timestamp, integer, text, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { vacanciesTable } from "./vacancies";
import { branchesTable } from "./branches";

// Vacancy Locations (Phase 3A, W48 in the frozen plan's own numbering —
// this session's W47): multi-location support for a vacancy
// (docs/PHASE_3A_RECRUITMENT_IMPLEMENTATION_PLAN.md §9). `branchId` is
// nullable — a vacancy can list a free-text location not tied to an
// existing branch (e.g. "Remote"), using `label` instead. `organizationId`
// is denormalized here, mirroring recruitment_stages.ts's established
// convention for a table that's org-scoped only via its parent.
export const vacancyLocationsTable = pgTable(
  "vacancy_locations",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    vacancyId: integer("vacancy_id")
      .notNull()
      .references(() => vacanciesTable.id, { onDelete: "cascade" }),
    branchId: integer("branch_id").references(() => branchesTable.id, { onDelete: "set null" }),
    label: text("label"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("vacancy_locations_vacancy_branch_unique").on(table.vacancyId, table.branchId),
    index("vacancy_locations_org_idx").on(table.organizationId),
    index("vacancy_locations_vacancy_idx").on(table.vacancyId),
  ],
);

export const insertVacancyLocationSchema = createInsertSchema(vacancyLocationsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertVacancyLocation = z.infer<typeof insertVacancyLocationSchema>;
export type VacancyLocation = typeof vacancyLocationsTable.$inferSelect;
