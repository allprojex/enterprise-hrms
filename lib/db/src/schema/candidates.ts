import { pgTable, text, serial, timestamp, integer, boolean, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { employeesTable } from "./employees";

// Candidates (Phase 3A, W49 — Public Careers Portal): the person/profile
// record behind a public application (docs/PHASE_3A_RECRUITMENT_IMPLEMENTATION_PLAN.md
// §3.3/§3.4/§9). Tenant-scoped per §3.4's frozen default — the same real
// person applying to two different organizations creates two independent
// rows with no cross-org linkage. Deduplicated within an organization by
// normalized email only. Never hard-deleted except via an explicit,
// permissioned retention purge (§16, not built in this workstream) —
// `isActive` exists for that future purge, not written to false anywhere
// in this workstream.
export const candidatesTable = pgTable(
  "candidates",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    email: text("email").notNull(),
    phone: text("phone"),
    address: jsonb("address"),
    nationality: text("nationality"),
    workAuthorizationStatus: text("work_authorization_status"),
    nationalIdentifierType: text("national_identifier_type"),
    nationalIdentifierValue: text("national_identifier_value"),
    experienceSummary: jsonb("experience_summary"),
    educationSummary: jsonb("education_summary"),
    skills: jsonb("skills"),
    languages: jsonb("languages"),
    // Fixed literal for this workstream — every candidate row is created
    // through the public careers apply endpoint; a source-selection UI
    // (referrals, agencies, ...) is a later workstream's concern.
    source: text("source").notNull().default("careers_portal"),
    linkedInternalEmployeeId: integer("linked_internal_employee_id").references(() => employeesTable.id, {
      onDelete: "set null",
    }),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("candidates_org_email_unique").on(table.organizationId, sql`lower(${table.email})`),
    index("candidates_org_idx").on(table.organizationId),
  ],
);

export const insertCandidateSchema = createInsertSchema(candidatesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertCandidate = z.infer<typeof insertCandidateSchema>;
export type Candidate = typeof candidatesTable.$inferSelect;
