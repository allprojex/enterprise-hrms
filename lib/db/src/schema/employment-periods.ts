import { pgTable, serial, integer, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { employeesTable } from "./employees";
import { usersTable } from "./users";

// Employment Period History (Phase 2A, W22, ADR-013): the richer home ADR-013
// anticipated for dated employment events. W15 (Employee Separation)
// deliberately used audit_events instead, since Foundation scope needed only
// a before/after diff; every Phase 2A workstream that records a dated
// employment event (transfer, promotion, confirmation) needs this instead.
// Append-only, mirrors audit_events' beforeState/afterState shape.
// `eventType` is free text like audit_events.eventType, not a hardcoded enum,
// so each consuming workstream (W25-W27) defines its own event type without
// a schema change here.
export const employmentPeriodsTable = pgTable(
  "employment_periods",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employeesTable.id, { onDelete: "restrict" }),
    eventType: text("event_type").notNull(),
    effectiveDate: timestamp("effective_date", { withTimezone: true }).notNull(),
    previousState: jsonb("previous_state"),
    newState: jsonb("new_state").notNull(),
    recordedBy: integer("recorded_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("employment_periods_org_idx").on(table.organizationId),
    index("employment_periods_org_employee_idx").on(table.organizationId, table.employeeId),
  ],
);

export const insertEmploymentPeriodSchema = createInsertSchema(employmentPeriodsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertEmploymentPeriod = z.infer<typeof insertEmploymentPeriodSchema>;
export type EmploymentPeriod = typeof employmentPeriodsTable.$inferSelect;
