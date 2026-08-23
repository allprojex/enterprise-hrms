import { pgTable, serial, integer, text, timestamp, pgEnum, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { personnelFilesTable } from "./personnel-files";
import { personnelFileVolumesTable } from "./personnel-file-volumes";
import { organizationMembershipsTable } from "./organization-memberships";

export const personnelFileMovementEventTypeEnum = pgEnum("personnel_file_movement_event_type", [
  "checked_out",
  "returned",
  "marked_missing",
  "recovered",
]);

// Phase 3H, W116 — Physical-File Custody & Movement (frozen plan §7b).
// Event-sourced, append-only, immutable — every row is a discrete fact,
// never an editable stateful record; "overdue" is never a column here or
// anywhere else (always derived live in lib/personnelFileCustody.ts from
// expectedReturnDate against the current unresolved checked_out event).
// Identity is always personnelFileId (+ optional volumeId) — never a PIF or
// staff-number string — so this history survives staff-number reuse
// unaffected (frozen plan §5/§6's own reuse guarantees apply here by
// construction, since this table never references either string at all).
export const personnelFileMovementsTable = pgTable(
  "personnel_file_movements",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    personnelFileId: integer("personnel_file_id")
      .notNull()
      .references(() => personnelFilesTable.id, { onDelete: "restrict" }),
    // Nullable — an organization not using volumes tracks custody on the
    // personnel file itself directly (frozen plan §7a step 6).
    volumeId: integer("volume_id").references(() => personnelFileVolumesTable.id, { onDelete: "restrict" }),
    eventType: personnelFileMovementEventTypeEnum("event_type").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    actorMembershipId: integer("actor_membership_id").references(() => organizationMembershipsTable.id, { onDelete: "set null" }),
    // checked_out only — free text (never a structured/polymorphic holder
    // model beyond what the frozen plan itself sketches: purpose/
    // destination/expectedReturnDate as plain fields).
    purpose: text("purpose"),
    destination: text("destination"),
    expectedReturnDate: timestamp("expected_return_date", { withTimezone: true }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("personnel_file_movements_org_file_idx").on(table.organizationId, table.personnelFileId),
    index("personnel_file_movements_org_volume_idx").on(table.organizationId, table.volumeId),
  ],
);

export const insertPersonnelFileMovementSchema = createInsertSchema(personnelFileMovementsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertPersonnelFileMovement = z.infer<typeof insertPersonnelFileMovementSchema>;
export type PersonnelFileMovement = typeof personnelFileMovementsTable.$inferSelect;
