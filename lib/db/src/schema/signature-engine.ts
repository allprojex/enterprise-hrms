/**
 * WS-26B — Signature & Signature Device Engine.
 *
 * Two additive, tenant-scoped tables that sit ABOVE the WS-26A form engine
 * without altering it. WS-26A reserved every hook these consume: the version's
 * `signature_policy` (slots × methods), the stage's `signature_slot_key`, the
 * `signature_applied` / `signature_revoked` submission events, and the
 * `form.signature.apply` permission. WS-26B adds the storage of the signatures
 * themselves — never a column on a WS-26A table.
 *
 *   signature_assets  — a person's stored, authorized signature image. Owned by
 *                       one user/membership; only that owner may read it or
 *                       nominate it for application; possession is NEVER
 *                       authorization to sign (that is checked per stage).
 *   form_signatures   — ONE row per application of a signature to a slot on a
 *                       submission revision. Never reused: each application
 *                       writes its own immutable PNG object and hash. Revocation
 *                       is a new fact (revoked_at/by/reason), never a delete, so
 *                       a finalized document's historical signature state is
 *                       immutable.
 *
 * Tenant boundary: every table carries `organization_id NOT NULL`; the 0077
 * migration enables RLS deny-by-default on each (CI's RLS coverage gate);
 * services scope every query by the organization id proven by
 * requireMembership. Signature bytes live under the organization prefix via
 * `writeOrgFile` and are served ONLY through permission-checked routes, never
 * as static/public files.
 */
import { pgTable, serial, integer, text, timestamp, jsonb, pgEnum, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { organizationMembershipsTable } from "./organization-memberships";
import { employeesTable } from "./employees";
import { usersTable } from "./users";
import { formSubmissionsTable, formSubmissionRevisionsTable, formTemplateVersionsTable } from "./form-engine";

/** A stored signature asset is usable until its owner revokes it. Revocation is a status, never a delete. */
export const signatureAssetStatusEnum = pgEnum("signature_asset_status", ["active", "revoked"]);

/** How a signature reached the system. Three disjoint capture paths; device is opaque to the core. */
export const formSignatureMethodEnum = pgEnum("form_signature_method", ["drawn", "uploaded", "device"]);

/**
 * A person's stored, authorized signature image. The owner uploads it once;
 * applying it to any document is a separate, explicit per-submission action
 * (never automatic). Only the owner may read or nominate it.
 */
export const signatureAssetsTable = pgTable(
  "signature_assets",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    /** The signer who owns this stored signature; the only user who may read or apply it. */
    ownerUserId: integer("owner_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    ownerMembershipId: integer("owner_membership_id")
      .notNull()
      .references(() => organizationMembershipsTable.id, { onDelete: "restrict" }),
    /** Opaque, server-generated storage key under the org's "signature-assets" prefix. */
    storageKey: text("storage_key").notNull(),
    sha256: text("sha256").notNull(),
    mimeType: text("mime_type").notNull(),
    widthPx: integer("width_px"),
    heightPx: integer("height_px"),
    byteSize: integer("byte_size"),
    status: signatureAssetStatusEnum("status").notNull().default("active"),
    uploadedByMembershipId: integer("uploaded_by_membership_id").references(() => organizationMembershipsTable.id, {
      onDelete: "set null",
    }),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedByMembershipId: integer("revoked_by_membership_id").references(() => organizationMembershipsTable.id, {
      onDelete: "set null",
    }),
    revokeReason: text("revoke_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("signature_assets_org_owner_idx").on(table.organizationId, table.ownerUserId),
    index("signature_assets_org_status_idx").on(table.organizationId, table.status),
  ],
);

/**
 * One row per application of a signature to a slot on a submission revision.
 * Append-only and never reused: even when applied from a stored asset, fresh
 * PNG bytes are written and hashed here so the document's record is
 * self-contained and the asset can later be revoked without altering history.
 */
export const formSignaturesTable = pgTable(
  "form_signatures",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    submissionId: integer("submission_id")
      .notNull()
      .references(() => formSubmissionsTable.id, { onDelete: "cascade" }),
    /** The immutable revision that was signed. */
    revisionId: integer("revision_id")
      .notNull()
      .references(() => formSubmissionRevisionsTable.id, { onDelete: "cascade" }),
    templateVersionId: integer("template_version_id")
      .notNull()
      .references(() => formTemplateVersionsTable.id, { onDelete: "restrict" }),
    /** The signature slot (a `kind:"signature"` item key in the version definition). */
    slotKey: text("slot_key").notNull(),
    signerUserId: integer("signer_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    signerMembershipId: integer("signer_membership_id")
      .notNull()
      .references(() => organizationMembershipsTable.id, { onDelete: "restrict" }),
    /** The employee the signer represents where the slot concerns a specific person (e.g. the subject). */
    representedEmployeeId: integer("represented_employee_id").references(() => employeesTable.id, {
      onDelete: "set null",
    }),
    /** The role/participant/capacity resolved for the signer at signing time (recorded, not inferred later). */
    authority: text("authority").notNull(),
    stageOrder: integer("stage_order"),
    method: formSignatureMethodEnum("method").notNull(),
    /** Provenance only, for method="uploaded"; the bytes below are an independent copy, not a reference. */
    sourceAssetId: integer("source_asset_id").references(() => signatureAssetsTable.id, { onDelete: "restrict" }),
    /** For method="device": the adapter/provider id; the core never speaks a vendor SDK. */
    deviceProvider: text("device_provider"),
    deviceMetadata: jsonb("device_metadata"),
    /** Opaque, server-generated storage key under the org's "signatures" prefix. */
    storageKey: text("storage_key").notNull(),
    sha256: text("sha256").notNull(),
    mimeType: text("mime_type").notNull(),
    widthPx: integer("width_px"),
    heightPx: integer("height_px"),
    byteSize: integer("byte_size"),
    signedAt: timestamp("signed_at", { withTimezone: true }).notNull().defaultNow(),
    requestId: text("request_id"),
    /** A one-way hash of the session identifier — evidence of the signing session without storing it. */
    sessionIdHash: text("session_id_hash"),
    userAgent: text("user_agent"),
    /** Revocation of an application is a new fact, never a delete; finalized history stays immutable. */
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedByMembershipId: integer("revoked_by_membership_id").references(() => organizationMembershipsTable.id, {
      onDelete: "set null",
    }),
    revokeReason: text("revoke_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // At most one ACTIVE signature per (submission, slot); a revoked one frees the slot for re-signing.
    uniqueIndex("form_signatures_submission_slot_active_unique")
      .on(table.submissionId, table.slotKey)
      .where(sql`${table.revokedAt} IS NULL`),
    index("form_signatures_org_idx").on(table.organizationId),
    index("form_signatures_submission_idx").on(table.submissionId),
    index("form_signatures_org_signer_idx").on(table.organizationId, table.signerUserId),
  ],
);

export const insertSignatureAssetSchema = createInsertSchema(signatureAssetsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertSignatureAsset = z.infer<typeof insertSignatureAssetSchema>;
export type SignatureAsset = typeof signatureAssetsTable.$inferSelect;

export const insertFormSignatureSchema = createInsertSchema(formSignaturesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertFormSignature = z.infer<typeof insertFormSignatureSchema>;
export type FormSignature = typeof formSignaturesTable.$inferSelect;

export type SignatureAssetStatus = SignatureAsset["status"];
export type FormSignatureMethod = FormSignature["method"];
