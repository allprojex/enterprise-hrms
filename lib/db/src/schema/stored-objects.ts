import { pgTable, serial, integer, text, bigint, timestamp, pgEnum, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";

// WS-17 File Storage Durability, Pass 1 — the shared record of a stored
// BINARY, and nothing else.
//
// WHAT THIS TABLE IS NOT, AND MUST NEVER BECOME
//
// It is NOT a second document registry. WS-5's `organization_documents` /
// `organization_document_versions`, `employee_documents`, `generated_documents`,
// `candidate_documents`, `background_checks` and the rest remain the sole
// authorities for what a file MEANS: its title, its owner, its category, its
// confidentiality, its retention basis, its recruitment or performance
// significance. This table knows only that some bytes were persisted, where,
// how big they were, and what they hashed to.
//
// If a column here would ever need to answer "what is this document?", it
// belongs in the owning module's table instead.
//
// WHY IT IS KEYED ON (organizationId, storageKey) AND HAS NO FOREIGN KEY
//
// Twelve modules write binaries, and ten tables already store the opaque
// storage key returned by `writeOrgFile`. Adding a checksum + backend column
// to all ten would duplicate the same two facts ten times; adding a foreign
// key from all ten into this table would touch every one of those tables and
// every consumer.
//
// Keying instead on the storage key those tables ALREADY hold means business
// tables need no change at all — which is what makes this pass backward
// compatible by construction (§18). A pre-Pass-1 file simply has no row here:
// it stays fully readable, and its integrity is honestly reported as UNKNOWN
// rather than fabricated. Nothing is backfilled by reading a file.
export const storedObjectBackendEnum = pgEnum("stored_object_backend", ["filesystem", "s3"]);

// `stored` — bytes are present as far as this platform knows.
// `deleted` — physical deletion succeeded; the row is retained as history.
// `delete_failed` — physical deletion was attempted and FAILED. This is the
//   state that replaces the old silent `.catch(() => undefined)`: business
//   semantics still treat the file as gone, but the platform can now find
//   every byte it failed to remove instead of never learning about it.
// `orphaned` — the binary was written but its business transaction failed AND
//   the compensating delete also failed. Nothing references these bytes.
export const storedObjectStatusEnum = pgEnum("stored_object_status", [
  "stored",
  "deleted",
  "delete_failed",
  "orphaned",
]);

export const storedObjectsTable = pgTable(
  "stored_objects",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    // The SAME opaque, server-generated key the owning business record
    // stores. Never client-supplied, never a filesystem path, never a
    // provider URL — the organization is always a separate argument, so a key
    // alone can never address another tenant's bytes.
    storageKey: text("storage_key").notNull(),
    // Which backend held these bytes when the row was written. Constant across
    // every row today (one backend is configured per installation), and
    // load-bearing later: a future migration pass moves objects between
    // backends, and this is how each object's location stays knowable during
    // a partial migration.
    backend: storedObjectBackendEnum("backend").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    // Lower-case hex SHA-256, computed once from the buffer already in memory
    // at write time — never by re-reading the object, and never on a download.
    checksumSha256: text("checksum_sha256").notNull(),
    status: storedObjectStatusEnum("status").notNull().default("stored"),
    // Set when status last moved to deleted/delete_failed/orphaned, so
    // reconciliation can age failures rather than only count them.
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }),
    // Free text for an operator: the failure class that produced a
    // delete_failed/orphaned row. Never a file path, never a secret.
    statusDetail: text("status_detail"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One row per stored object per tenant. The key is 24 random bytes, so a
    // collision within an organization is not a practical concern — this
    // index exists to make the natural key authoritative and to make lookup
    // by (org, key) an index hit rather than a scan.
    uniqueIndex("stored_objects_org_key_unique").on(table.organizationId, table.storageKey),
    // Reconciliation reads: "everything needing attention in this tenant".
    index("stored_objects_org_status_idx").on(table.organizationId, table.status),
  ],
);

export const insertStoredObjectSchema = createInsertSchema(storedObjectsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertStoredObject = z.infer<typeof insertStoredObjectSchema>;
export type StoredObject = typeof storedObjectsTable.$inferSelect;
export type StoredObjectBackend = (typeof storedObjectBackendEnum.enumValues)[number];
export type StoredObjectStatus = (typeof storedObjectStatusEnum.enumValues)[number];
