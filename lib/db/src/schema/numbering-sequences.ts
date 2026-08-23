import { pgTable, serial, integer, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";

// Phase 3H, W114 — Numbering & Identifier History. Concurrency-safe counter
// backing the organization-level numbering-format engine (employee/staff
// numbers today, PIF numbers from W115 on) — fixes the disclosed
// count()-based race in the old generateEmployeeNumber(). One row per
// (organization, sequence, reset period); incremented via SELECT ... FOR
// UPDATE inside the same transaction as the allocation-row insert (see
// lib/numbering.ts), never SELECT MAX(...) + 1. `periodKey` is the empty
// string, never NULL, when an organization's reset policy is "never" — a
// nullable periodKey would let Postgres treat every "never-reset" row as
// distinct (NULLs are never equal to each other in a unique index), silently
// defeating the single-counter guarantee this table exists to provide.
export const numberingSequencesTable = pgTable(
  "numbering_sequences",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    // "employee_number" | "pif_number" — free text, not an enum, so a later
    // workstream (W115, PIF numbering) can introduce its own sequence key
    // without a schema change here, mirroring employment_periods.eventType's
    // own established free-text convention.
    sequenceKey: text("sequence_key").notNull(),
    periodKey: text("period_key").notNull().default(""),
    currentValue: integer("current_value").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("numbering_sequences_org_key_period_unique").on(
      table.organizationId,
      table.sequenceKey,
      table.periodKey,
    ),
  ],
);

export const insertNumberingSequenceSchema = createInsertSchema(numberingSequencesTable).omit({
  id: true,
  updatedAt: true,
});

export type InsertNumberingSequence = z.infer<typeof insertNumberingSequenceSchema>;
export type NumberingSequence = typeof numberingSequencesTable.$inferSelect;
