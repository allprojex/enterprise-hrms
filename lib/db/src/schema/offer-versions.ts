import { pgTable, text, serial, timestamp, integer, date, jsonb, pgEnum, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { offersTable } from "./offers";
import { employmentTypeEnum } from "./employees";
import { documentTemplatesTable } from "./document-templates";

// Offer Versions (Phase 3A, W57 — Offers): immutable offer content per
// revision — the actual envelope contents (§9/§14). Column list is exactly
// §9's `offer_versions` row. Reuses `employmentTypeEnum` (employees.ts,
// already shared with job_requisitions/leave_policies) rather than a
// fourth copy; `workplaceType` gets its own enum here, mirroring
// job_requisitions.ts's own per-table precedent (workplace type has never
// been a shared enum across tables in this codebase).
//
// Status model (§4.6): `draft -> pending_approval -> approved -> issued ->
// (accepted | declined | expired | withdrawn)`, with `superseded` applied
// to a prior version when a new one is created while the prior is
// `approved`/`issued` (§14). Editing a `draft` version updates that row in
// place; editing an `approved`/`issued` one creates a new version row
// instead — enforced in lib/offers.ts, not at the schema level.
//
// `letterTemplateId`/`generatedDocumentStorageKey` are reserved columns per
// §9's own key-column list — both nullable and never populated by any route
// in this workstream, mirroring `vacancies.publicId`'s and
// `interview_scorecards.externalInterviewerToken`'s own "reserved for a
// later workstream, not consumed here" precedent. WS-5 (Documents & Records
// Foundation, Owner Decision #4) later built the generation engine these
// fields were reserved for (document-templates.ts) and added the FK below
// as pure infrastructure wiring — no recruitment business behavior changes,
// no route populates either column here; that remains WS-9's own scope.
export const offerVersionWorkplaceTypeEnum = pgEnum("offer_version_workplace_type", ["onsite", "remote", "hybrid"]);
export const offerVersionStatusEnum = pgEnum("offer_version_status", [
  "draft",
  "pending_approval",
  "approved",
  "issued",
  "accepted",
  "declined",
  "expired",
  "withdrawn",
  "superseded",
]);

export const offerVersionsTable = pgTable(
  "offer_versions",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    offerId: integer("offer_id")
      .notNull()
      .references(() => offersTable.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    proposedStartDate: date("proposed_start_date"),
    employmentType: employmentTypeEnum("employment_type"),
    workplaceType: offerVersionWorkplaceTypeEnum("workplace_type"),
    location: text("location"),
    // Recruitment-scoped fields only (base salary, currency, bonus,
    // benefits summary) — never a full payroll/compensation structure
    // (CLAUDE.md/§2 principle 7: no payroll dependency). Stored as-is, no
    // internal shape enforced, the same precedent every other free-form
    // jsonb column in this codebase already follows (e.g.
    // candidates.experienceSummary).
    compensationSummary: jsonb("compensation_summary"),
    conditions: text("conditions"),
    expiryDate: date("expiry_date"),
    letterTemplateId: integer("letter_template_id").references(() => documentTemplatesTable.id, { onDelete: "set null" }),
    generatedDocumentStorageKey: text("generated_document_storage_key"),
    status: offerVersionStatusEnum("status").notNull().default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("offer_versions_offer_version_number_unique").on(table.offerId, table.versionNumber),
    index("offer_versions_org_idx").on(table.organizationId),
    index("offer_versions_offer_idx").on(table.offerId),
    index("offer_versions_status_idx").on(table.status),
  ],
);

export const insertOfferVersionSchema = createInsertSchema(offerVersionsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOfferVersion = z.infer<typeof insertOfferVersionSchema>;
export type OfferVersion = typeof offerVersionsTable.$inferSelect;
