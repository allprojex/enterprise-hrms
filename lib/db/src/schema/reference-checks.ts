import { pgTable, text, serial, timestamp, integer, pgEnum, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { applicationsTable } from "./applications";

// Reference Checks (Phase 3A, W56 — Reference & Background Checks): status-
// tracked, no vendor integration (docs/PHASE_3A_RECRUITMENT_IMPLEMENTATION_PLAN.md
// §23 W56 objective). Column list is exactly §9's `reference_checks` row —
// applicationId, refereeName/Contact/Relationship, status, notes,
// completedAt. No dedicated `reference_check.*` permission exists in §7's
// matrix — visibility/write reuse the existing `application.read`/`.manage`
// pair (assigned recruiter/hiring manager + organization-wide), the same
// tier as viewing/scoring the application itself (W52's exact precedent).
//
// Status model (§4.7, shared with background_checks):
// `requested -> in_progress -> (completed | flagged | unable_to_complete)`.
// No "cancelled"/"expired" state exists in the frozen model — a check that
// can't be completed is recorded as `unable_to_complete`, not cancelled.
export const referenceBackgroundCheckStatusEnum = pgEnum("reference_background_check_status", ["requested", "in_progress", "completed", "flagged", "unable_to_complete"]);

export const referenceChecksTable = pgTable(
  "reference_checks",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    applicationId: integer("application_id")
      .notNull()
      .references(() => applicationsTable.id, { onDelete: "cascade" }),
    refereeName: text("referee_name").notNull(),
    refereeContact: text("referee_contact").notNull(),
    refereeRelationship: text("referee_relationship"),
    status: referenceBackgroundCheckStatusEnum("status").notNull().default("requested"),
    notes: text("notes"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("reference_checks_org_idx").on(table.organizationId),
    index("reference_checks_application_idx").on(table.applicationId),
    index("reference_checks_status_idx").on(table.status),
  ],
);

export const insertReferenceCheckSchema = createInsertSchema(referenceChecksTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertReferenceCheck = z.infer<typeof insertReferenceCheckSchema>;
export type ReferenceCheck = typeof referenceChecksTable.$inferSelect;
