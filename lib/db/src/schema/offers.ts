import { pgTable, serial, timestamp, integer, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { applicationsTable } from "./applications";

// Offers (Phase 3A, W57 — Offers): a stable envelope per application — the
// actual content lives in `offer_versions`, never here
// (docs/PHASE_3A_RECRUITMENT_IMPLEMENTATION_PLAN.md §14). `currentVersionId`
// always points at the latest non-superseded version; nullable only for the
// brief instant between inserting this row and its first version within the
// same transaction (see lib/offers.ts's createOffer).
//
// Unique on `applicationId` — §9's own row marks this "unique where policy
// disallows multiple active offers", conditioned on an org policy flag
// (§17's `multipleActiveOffersAllowed`). That field does not exist in this
// codebase's actual `recruitment_settings` table (already diverged from
// §9's prose before this workstream, per W44/W47's own documented gaps) —
// rather than speculatively adding a new settings column, this workstream
// unconditionally enforces the frozen default (one offer envelope per
// application, always), the same "follow the real schema, don't invent a
// column" discipline W44/W47 already established.
export const offersTable = pgTable(
  "offers",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    applicationId: integer("application_id")
      .notNull()
      .references(() => applicationsTable.id, { onDelete: "cascade" }),
    // No FK declared here — offer_versions.offerId already references this
    // table, and Drizzle/Postgres can't express a mutual FK cycle between
    // two tables declared in the same migration; enforced at the
    // application layer instead (always set inside the same transaction
    // that creates the first version).
    currentVersionId: integer("current_version_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex("offers_application_unique").on(table.applicationId), index("offers_org_idx").on(table.organizationId)],
);

export const insertOfferSchema = createInsertSchema(offersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOffer = z.infer<typeof insertOfferSchema>;
export type Offer = typeof offersTable.$inferSelect;
