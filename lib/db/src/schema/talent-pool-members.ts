import { pgTable, serial, integer, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { talentPoolsTable } from "./talent-pools";
import { candidatesTable } from "./candidates";
import { organizationMembershipsTable } from "./organization-memberships";

// Talent Pool Members (Phase 3A, W53 — Candidate Notes, Tags, and Talent
// Pools): pool membership (docs/PHASE_3A_RECRUITMENT_IMPLEMENTATION_PLAN.md
// §9) — a pure join table, add/remove only (no "role in pool" or other
// membership metadata beyond who added the candidate and when). A
// candidate may belong to any number of pools simultaneously, and pool
// membership is never tied to a specific vacancy — the same candidate
// record (W49) is reused across pools and future campaigns.
export const talentPoolMembersTable = pgTable(
  "talent_pool_members",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    talentPoolId: integer("talent_pool_id")
      .notNull()
      .references(() => talentPoolsTable.id, { onDelete: "cascade" }),
    candidateId: integer("candidate_id")
      .notNull()
      .references(() => candidatesTable.id, { onDelete: "cascade" }),
    addedByMembershipId: integer("added_by_membership_id").references(() => organizationMembershipsTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("talent_pool_members_pool_candidate_unique").on(table.talentPoolId, table.candidateId),
    index("talent_pool_members_org_idx").on(table.organizationId),
    index("talent_pool_members_pool_idx").on(table.talentPoolId),
    index("talent_pool_members_candidate_idx").on(table.candidateId),
  ],
);

export const insertTalentPoolMemberSchema = createInsertSchema(talentPoolMembersTable).omit({
  id: true,
  createdAt: true,
});

export type InsertTalentPoolMember = z.infer<typeof insertTalentPoolMemberSchema>;
export type TalentPoolMember = typeof talentPoolMembersTable.$inferSelect;
