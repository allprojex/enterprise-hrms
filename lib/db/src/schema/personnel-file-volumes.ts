import { pgTable, serial, integer, timestamp, pgEnum, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { personnelFilesTable, custodyStateEnum } from "./personnel-files";
import { recordsLocationsTable } from "./records-locations";

export const personnelFileVolumeStatusEnum = pgEnum("personnel_file_volume_status", ["open", "closed"]);

// Phase 3H, W116 — Physical Filing (frozen plan §7a step 5 / Decision 8). A
// child of the personnel-file identity, never a sibling — "a new volume
// must not become a new employee" applied here to volumes-vs-personnel-file
// identity. volumeNumber is sequential per personnelFileId, enforced by the
// unique index below (never COUNT+1 alone — see createNextVolume's own
// SELECT...FOR UPDATE + retry-on-collision in lib/personnelFileCustody.ts).
// No pifNumber column here — that stays solely on personnel_files; a
// volume's own PIF is always resolved through its parent, never duplicated.
export const personnelFileVolumesTable = pgTable(
  "personnel_file_volumes",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    personnelFileId: integer("personnel_file_id")
      .notNull()
      .references(() => personnelFilesTable.id, { onDelete: "restrict" }),
    volumeNumber: integer("volume_number").notNull(),
    status: personnelFileVolumeStatusEnum("status").notNull().default("open"),
    currentLocationId: integer("current_location_id").references(() => recordsLocationsTable.id, { onDelete: "set null" }),
    currentCustodyState: custodyStateEnum("current_custody_state").notNull().default("in_registry"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex("personnel_file_volumes_file_number_unique").on(table.personnelFileId, table.volumeNumber)],
);

export const insertPersonnelFileVolumeSchema = createInsertSchema(personnelFileVolumesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertPersonnelFileVolume = z.infer<typeof insertPersonnelFileVolumeSchema>;
export type PersonnelFileVolume = typeof personnelFileVolumesTable.$inferSelect;
