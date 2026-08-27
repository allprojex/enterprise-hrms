import { pgTable, serial, integer, text, timestamp, jsonb, pgEnum, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { organizationMembershipsTable } from "./organization-memberships";
import { offersTable } from "./offers";
import { offerVersionsTable } from "./offer-versions";

/**
 * WS-9 — Offer responses and candidate response tokens
 * (see docs/ENTERPRISE_HRMS_MASTER_OWNER_REVIEW.md §25.11, §25.13).
 *
 * The `offer_version_status` enum already carried `accepted`, `declined` and
 * `withdrawn`; the reconciliation found that **no code path ever wrote them**.
 * These tables make those states reachable through real domain events, and
 * bind every one of them to an exact offer VERSION — an acceptance of
 * revision 1 must never be readable as acceptance of revision 2.
 */

export const offerResponseTypeEnum = pgEnum("offer_response_type", ["accepted", "declined", "withdrawn"]);

/** How the response reached the system — evidence of acceptance, not a signature claim (§25.12). */
export const offerResponseChannelEnum = pgEnum("offer_response_channel", [
  /** The candidate acted on a single-purpose response link. */
  "candidate_token",
  /** Recorded by authorized HR/Recruitment staff on the candidate's behalf (phone, in person, email). */
  "recorded_by_staff",
]);

/**
 * One terminal response per offer version. Append-only: a response is never
 * edited, and a superseding revision gets its own row rather than mutating
 * this one.
 */
export const offerResponsesTable = pgTable(
  "offer_responses",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    offerId: integer("offer_id")
      .notNull()
      .references(() => offersTable.id, { onDelete: "restrict" }),
    /** The exact revision responded to. This binding is the whole point of the table. */
    offerVersionId: integer("offer_version_id")
      .notNull()
      .references(() => offerVersionsTable.id, { onDelete: "restrict" }),
    responseType: offerResponseTypeEnum("response_type").notNull(),
    channel: offerResponseChannelEnum("channel").notNull(),
    /** Required for withdrawal; optional elsewhere unless the organization requires it. */
    reason: text("reason"),
    /**
     * Non-sensitive corroboration of the response — e.g.
     * `{ recordedVia: "phone", note: "confirmed with candidate" }`. Never the
     * token, never document contents.
     */
    evidence: jsonb("evidence"),
    /** Set only for `recorded_by_staff`; null when the candidate acted themselves. */
    respondedByMembershipId: integer("responded_by_membership_id").references(() => organizationMembershipsTable.id, {
      onDelete: "set null",
    }),
    respondedAt: timestamp("responded_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // A revision reaches a terminal response exactly once.
    uniqueIndex("offer_responses_version_unique").on(table.offerVersionId),
    index("offer_responses_org_offer_idx").on(table.organizationId, table.offerId),
  ],
);

/**
 * A single-purpose, expiring, revocable candidate response link (§25.13).
 *
 * Modelled on the platform's existing candidate-facing precedent
 * (`applications.statusCheckToken` + its dedicated rate limiter) rather than
 * inventing a new mechanism — but hardened further, because this token
 * authorizes a *decision* rather than a read:
 *
 *   - only the SHA-256 hash is stored, so a database disclosure does not yield
 *     usable links (the status-check precedent stores its token in plaintext;
 *     this is deliberately stronger, not a copy);
 *   - bound to one organization, one offer and one offer VERSION;
 *   - single-use (`usedAt`) and independently revocable (`revokedAt`), so
 *     superseding or withdrawing an offer kills its outstanding links;
 *   - expiring, independent of the offer's own expiry date.
 *
 * No candidate account system is created — §25.12 forbids inventing one solely
 * for offer acceptance.
 */
export const offerResponseTokensTable = pgTable(
  "offer_response_tokens",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    offerId: integer("offer_id")
      .notNull()
      .references(() => offersTable.id, { onDelete: "cascade" }),
    offerVersionId: integer("offer_version_id")
      .notNull()
      .references(() => offerVersionsTable.id, { onDelete: "cascade" }),
    /** SHA-256 of the issued token. The plaintext is returned once, at issuance, and never stored. */
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdByMembershipId: integer("created_by_membership_id").references(() => organizationMembershipsTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("offer_response_tokens_hash_unique").on(table.tokenHash),
    index("offer_response_tokens_version_idx").on(table.offerVersionId),
  ],
);

export const insertOfferResponseSchema = createInsertSchema(offerResponsesTable).omit({ id: true, createdAt: true });
export type InsertOfferResponse = z.infer<typeof insertOfferResponseSchema>;
export type OfferResponse = typeof offerResponsesTable.$inferSelect;
export type OfferResponseToken = typeof offerResponseTokensTable.$inferSelect;
export type OfferResponseType = OfferResponse["responseType"];
