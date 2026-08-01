import { pgTable, serial, timestamp, integer, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { candidatesTable } from "./candidates";
import { applicationsTable } from "./applications";
import { employeesTable } from "./employees";
import { organizationMembershipsTable } from "./organization-memberships";

// Candidate-Employee Links (Phase 3A, W59 — Employee Conversion): the
// provenance record left behind once an application converts to a real
// `employees` row (docs/PHASE_3A_RECRUITMENT_IMPLEMENTATION_PLAN.md
// §9/§13). Column list is exactly §9's own row — `candidateId`,
// `applicationId`, `employeeId`, `convertedAt`, `convertedByMembershipId`.
// Immutable once created ("is itself an audit record", per §9) — no
// update/delete path exists anywhere in this workstream.
//
// Unique on `applicationId` (one conversion per application) AND unique on
// `employeeId` (one recruitment provenance per employee) — both
// constraints exist so `lib/employeeConversion.ts`'s insert can rely
// solely on catching a DB unique-violation race to detect a double
// conversion attempt (mirrors offers.ts's createOffer / W58's
// createPreEmploymentRequirement precedent), covering both directions:
// re-converting the same application twice, and an internal candidate's
// existing employee record being linked to a second application.
export const candidateEmployeeLinksTable = pgTable(
  "candidate_employee_links",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    candidateId: integer("candidate_id")
      .notNull()
      .references(() => candidatesTable.id, { onDelete: "restrict" }),
    applicationId: integer("application_id")
      .notNull()
      .references(() => applicationsTable.id, { onDelete: "restrict" }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employeesTable.id, { onDelete: "restrict" }),
    convertedAt: timestamp("converted_at", { withTimezone: true }).notNull().defaultNow(),
    convertedByMembershipId: integer("converted_by_membership_id").references(() => organizationMembershipsTable.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    uniqueIndex("candidate_employee_links_application_unique").on(table.applicationId),
    uniqueIndex("candidate_employee_links_employee_unique").on(table.employeeId),
    index("candidate_employee_links_org_idx").on(table.organizationId),
    index("candidate_employee_links_candidate_idx").on(table.candidateId),
  ],
);

export const insertCandidateEmployeeLinkSchema = createInsertSchema(candidateEmployeeLinksTable).omit({
  id: true,
});

export type InsertCandidateEmployeeLink = z.infer<typeof insertCandidateEmployeeLinkSchema>;
export type CandidateEmployeeLink = typeof candidateEmployeeLinksTable.$inferSelect;
