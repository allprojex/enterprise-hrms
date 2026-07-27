import { pgTable, serial, integer, timestamp, text, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";

// Purely descriptive/reporting metadata (e.g. a diocese and its member
// churches, a franchise group). Never consulted by authorization logic — a
// relationship row here must never grant access between organizations.
export const organizationRelationshipsTable = pgTable(
  "organization_relationships",
  {
    id: serial("id").primaryKey(),
    fromOrganizationId: integer("from_organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    toOrganizationId: integer("to_organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    relationshipType: text("relationship_type").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("organization_relationships_pair_type_unique").on(
      table.fromOrganizationId,
      table.toOrganizationId,
      table.relationshipType,
    ),
    index("organization_relationships_from_idx").on(table.fromOrganizationId),
    index("organization_relationships_to_idx").on(table.toOrganizationId),
  ],
);

export const insertOrganizationRelationshipSchema = createInsertSchema(organizationRelationshipsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertOrganizationRelationship = z.infer<typeof insertOrganizationRelationshipSchema>;
export type OrganizationRelationship = typeof organizationRelationshipsTable.$inferSelect;
