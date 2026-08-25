import { pgTable, serial, integer, text, varchar, boolean, date, pgEnum, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { usersTable } from "./users";

// WS-5 — the shared "required / provided / verified / expiry" checklist
// primitive (§12 of the frozen scope), generic enough for Recruitment (WS-9),
// Onboarding (WS-10), and employee-lifecycle/compliance workflows to consume
// without becoming a workflow engine itself: it records one fact — "this
// category of document is required for this owner, and here is its
// provided/verified/expiry state" — nothing about approval routing, stages,
// or notifications (that belongs to each consuming workflow / WS-6).
//
// `ownerType`/`ownerId` are a deliberate polymorphic pair rather than three
// separate nullable FK columns (one per owner table) — the set of owner
// domains is expected to grow (WS-9/WS-10/WS-12) and a fixed FK column per
// domain would need a schema change for each one. No DB-level FK is possible
// across a polymorphic pair; the owning workflow is responsible for
// validating ownerId against the right table for ownerType before writing
// here, the same discipline `document_retention_records` below uses for its
// own polymorphic pointer.
//
// `fulfilledDocumentTable`/`fulfilledDocumentId` point at whichever concrete
// row actually satisfied the requirement (an employee_documents row, a
// candidate_documents row, or an organization_document_versions row) —
// deliberately not duplicating that row's own fields here (§12: "avoid
// duplicating candidate/employee state if it can be derived safely").
export const documentRequirementOwnerTypeEnum = pgEnum("document_requirement_owner_type", ["employee", "candidate", "organization"]);
export const documentRequirementStatusEnum = pgEnum("document_requirement_status", ["pending", "provided", "verified", "rejected"]);

export const documentRequirementsTable = pgTable(
  "document_requirements",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    ownerType: documentRequirementOwnerTypeEnum("owner_type").notNull(),
    ownerId: integer("owner_id").notNull(),
    categoryCode: text("category_code").notNull(),
    required: boolean("required").notNull().default(true),
    status: documentRequirementStatusEnum("status").notNull().default("pending"),
    fulfilledDocumentTable: varchar("fulfilled_document_table", { length: 32 }),
    fulfilledDocumentId: integer("fulfilled_document_id"),
    verifiedBy: integer("verified_by").references(() => usersTable.id, { onDelete: "set null" }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    expiryDate: date("expiry_date"),
    rejectionReason: text("rejection_reason"),
    notes: text("notes"),
    createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("document_requirements_owner_category_unique").on(table.organizationId, table.ownerType, table.ownerId, table.categoryCode),
    index("document_requirements_owner_idx").on(table.organizationId, table.ownerType, table.ownerId),
    index("document_requirements_org_status_idx").on(table.organizationId, table.status),
    index("document_requirements_expiry_idx").on(table.organizationId, table.expiryDate),
  ],
);

export const insertDocumentRequirementSchema = createInsertSchema(documentRequirementsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertDocumentRequirement = z.infer<typeof insertDocumentRequirementSchema>;
export type DocumentRequirement = typeof documentRequirementsTable.$inferSelect;
