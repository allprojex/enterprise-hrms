import { pgTable, serial, integer, text, timestamp, jsonb, pgEnum, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { organizationMembershipsTable } from "./organization-memberships";
import { applicationsTable } from "./applications";
import { usersTable } from "./users";

/**
 * WS-9 — Recruitment approval configuration and hire authorization
 * (see docs/ENTERPRISE_HRMS_MASTER_OWNER_REVIEW.md §25.2–25.3).
 *
 * This is deliberately Recruitment-specific. OD #14 forbids replacing working
 * domain workflows with one generic workflow engine, so there is no rule DSL,
 * no expression evaluator and no generic state machine here — just an ordered
 * list of configured stages and an append-only decision log.
 *
 * The two purposes are kept apart because the platform previously conflated
 * them (reconciliation §8):
 *
 *   REQUISITION — "may this organization recruit for this role?"
 *   HIRE        — "may this specific candidate be employed?"
 */

export const recruitmentApprovalPurposeEnum = pgEnum("recruitment_approval_purpose", ["requisition", "hire"]);

/**
 * Server-defined authority resolvers (§25.2). A stage names one of these; it
 * cannot supply code. Adding a resolver is a deliberate code change, which is
 * what keeps "who may approve" analyzable.
 *
 *   department_head    — resolves through the authoritative `department_heads`
 *                        relationship for the subject's own department. This is
 *                        the resolver the reconciliation specifically asked for:
 *                        Department Head authority must never be inferred from
 *                        a role NAME.
 *   permission_holder  — any active member holding a named permission key. This
 *                        is the pre-existing behaviour of requisition/offer
 *                        approval, preserved as one option among several.
 *   specific_membership— one named person, for organizations whose Finance or
 *                        Executive sign-off genuinely rests with an individual.
 */
export const recruitmentAuthorityResolverEnum = pgEnum("recruitment_authority_resolver", [
  "department_head",
  "permission_holder",
  "specific_membership",
]);

export const recruitmentApprovalDecisionEnum = pgEnum("recruitment_approval_decision", ["approved", "rejected"]);

export const hireAuthorizationStatusEnum = pgEnum("hire_authorization_status", [
  "pending",
  "approved",
  "rejected",
  "cancelled",
]);

/**
 * One configured stage in an organization's chain. No stage is mandatory and
 * no sequence is hard-coded — an organization may configure one stage, several,
 * or none at all for a given purpose (§25.2).
 */
export const recruitmentApprovalStagesTable = pgTable(
  "recruitment_approval_stages",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    purpose: recruitmentApprovalPurposeEnum("purpose").notNull(),
    /** 1-based position in the chain. Stages are decided strictly in ascending order. */
    stageOrder: integer("stage_order").notNull(),
    /** The organization's own label, e.g. "Department Head", "Finance", "Executive". */
    name: text("name").notNull(),
    resolverType: recruitmentAuthorityResolverEnum("resolver_type").notNull(),
    /**
     * Resolver input, validated per resolver type by the service:
     *   permission_holder   -> { permissionKey }
     *   specific_membership -> { membershipId }
     *   department_head     -> {} (the subject supplies the department)
     */
    resolverConfig: jsonb("resolver_config"),
    createdByMembershipId: integer("created_by_membership_id").references(() => organizationMembershipsTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("recruitment_approval_stages_org_purpose_order_unique").on(table.organizationId, table.purpose, table.stageOrder),
    index("recruitment_approval_stages_org_purpose_idx").on(table.organizationId, table.purpose),
  ],
);

/**
 * "May this specific candidate be employed?" — one per application.
 *
 * This is the record the reconciliation found missing: previously an
 * application whose stage happened to be `hired`-category was treated as
 * authorized to employ, with no separate organizational decision.
 */
export const hireAuthorizationsTable = pgTable(
  "hire_authorizations",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    applicationId: integer("application_id")
      .notNull()
      .references(() => applicationsTable.id, { onDelete: "restrict" }),
    status: hireAuthorizationStatusEnum("status").notNull().default("pending"),
    /**
     * How many stages existed when this authorization was raised. Frozen at
     * request time so that reconfiguring the chain later cannot retroactively
     * change whether an in-flight authorization is complete.
     */
    totalStages: integer("total_stages").notNull(),
    /** The next stage awaiting a decision; null once the authorization is settled. */
    currentStageOrder: integer("current_stage_order"),
    requestedByMembershipId: integer("requested_by_membership_id").references(() => organizationMembershipsTable.id, {
      onDelete: "set null",
    }),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // One authorization per application — re-raising is an explicit cancel+new,
    // never a silent second parallel decision.
    uniqueIndex("hire_authorizations_application_unique").on(table.applicationId),
    index("hire_authorizations_org_status_idx").on(table.organizationId, table.status),
  ],
);

/**
 * Append-only decision log (§25.3). Nothing here is ever updated or deleted.
 *
 * The snapshot columns exist because current authority and historical decision
 * identity are different facts: if a Department Head is replaced, a role is
 * revoked, or the chain is reconfigured, the record of who decided what, under
 * what authority, must not change. `authorityBasis` records *why* the actor was
 * entitled to decide — the resolver that admitted them, in words.
 */
export const hireAuthorizationDecisionsTable = pgTable(
  "hire_authorization_decisions",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    hireAuthorizationId: integer("hire_authorization_id")
      .notNull()
      .references(() => hireAuthorizationsTable.id, { onDelete: "restrict" }),
    stageOrder: integer("stage_order").notNull(),
    /** Snapshots of the stage as configured at decision time. */
    stageName: text("stage_name").notNull(),
    resolverType: recruitmentAuthorityResolverEnum("resolver_type").notNull(),
    /** Human-readable statement of the authority relied on, e.g. "Department head of Finance". */
    authorityBasis: text("authority_basis").notNull(),
    decision: recruitmentApprovalDecisionEnum("decision").notNull(),
    reason: text("reason"),
    decidedByMembershipId: integer("decided_by_membership_id").references(() => organizationMembershipsTable.id, {
      onDelete: "set null",
    }),
    decidedByUserId: integer("decided_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    /** Actor's name as it was at decision time — survives renames and membership removal. */
    decidedByNameSnapshot: text("decided_by_name_snapshot"),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // A stage is decided exactly once per authorization.
    uniqueIndex("hire_authorization_decisions_stage_unique").on(table.hireAuthorizationId, table.stageOrder),
    index("hire_authorization_decisions_org_idx").on(table.organizationId),
  ],
);

export const insertRecruitmentApprovalStageSchema = createInsertSchema(recruitmentApprovalStagesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertRecruitmentApprovalStage = z.infer<typeof insertRecruitmentApprovalStageSchema>;
export type RecruitmentApprovalStage = typeof recruitmentApprovalStagesTable.$inferSelect;
export type HireAuthorization = typeof hireAuthorizationsTable.$inferSelect;
export type HireAuthorizationDecision = typeof hireAuthorizationDecisionsTable.$inferSelect;
export type RecruitmentAuthorityResolver = RecruitmentApprovalStage["resolverType"];
export type RecruitmentApprovalPurpose = RecruitmentApprovalStage["purpose"];
