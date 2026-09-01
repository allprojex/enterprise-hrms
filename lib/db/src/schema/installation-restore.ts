import { pgTable, serial, integer, text, jsonb, timestamp, pgEnum, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { installationsTable } from "./installations";
import { installationBackupRunsTable } from "./installation-operations";
import { usersTable } from "./users";

// WS-17 Restore Governance — physical restore, governed.
//
// EVERY TABLE HERE IS INSTALLATION-SCOPED. NONE CARRIES organizationId.
//
// A physical restore of a shared installation rolls back EVERY organization on
// it. Modelling a restore as organization-owned because an operator happened to
// pick a tenant in a UI would be the most dangerous lie this platform could
// tell: it would let someone believe they were recovering one customer while
// actually rewinding three. Affected tenants are DERIVED from
// `installation_organizations`, and the set the requester and approver actually
// saw is snapshotted so it cannot silently change underneath an approval.
//
// THE HRMS GOVERNS. INFRASTRUCTURE EXECUTES.
//
// Nothing here runs pg_restore, PITR, a snapshot rollback or any command. There
// is no shell, no SSH, no provider credential and no callback secret in this
// model. What it holds is intent, authority, risk acceptance and evidence.
//
// PHYSICAL RESTORE ONLY. Selective recovery of one tenant's data without
// rolling back its neighbours is a fundamentally different operation and is
// registered as WS-21; it is not expressible here, deliberately.

/** Recovery of real state, or a rehearsal proving recovery is possible. */
export const restorePurposeEnum = pgEnum("restore_purpose", ["recovery", "test"]);

/**
 * Where the recovery point comes from. Explicit, because a PITR timestamp is
 * not a backup run and inventing a fake backup row to represent one would
 * corrupt the backup evidence that Fleet Health reads.
 */
export const restorePointTypeEnum = pgEnum("restore_point_type", ["backup_run", "pitr", "provider_snapshot"]);

/**
 * Whether the recovery point is known to cover the whole recovery surface.
 * Derived from backup evidence via `deriveBackupRunResult` — never accepted
 * from a caller. `unknown` is NOT `complete`: the storage durability work
 * established that authoritative binaries live outside PostgreSQL, so a
 * database-only point cannot restore this application.
 */
export const restoreCompletenessEnum = pgEnum("restore_completeness", ["complete", "partial", "unknown"]);

/**
 * The pre-restore safety checkpoint. `unsupported_acknowledged` exists because
 * a customer-managed executor may genuinely be unable to take one — and
 * "unsupported" must never quietly become "completed".
 */
export const preRestoreCheckpointEnum = pgEnum("pre_restore_checkpoint_state", [
  "not_required",
  "required",
  "satisfied",
  "unsupported_acknowledged",
]);

/**
 * Whether writes were stopped before the restore. The control plane RECORDS
 * this; it does not stop traffic itself, and must never claim it did.
 * `unavailable` is the honest state for an installation with no such capability.
 */
export const quiescenceStateEnum = pgEnum("restore_quiescence_state", [
  "not_required",
  "required",
  "requested",
  "confirmed",
  "unavailable",
  "released",
]);

/**
 * The request lifecycle. Deliberately eleven states with no aliases —
 * `awaiting_approval` would duplicate `submitted`, `execution_requested` would
 * duplicate `dispatched`, and `validation_pending` is implied by `succeeded`.
 *
 * There is no `draft`: every material field, the risk acknowledgements and the
 * target-bound confirmation are required at creation, so a mutable pre-state
 * would only create a window in which a half-formed restore request exists.
 */
export const restoreRequestStatusEnum = pgEnum("installation_restore_request_status", [
  "submitted",
  "approved",
  "rejected",
  "dispatched",
  "executing",
  "succeeded",
  "failed",
  "validated",
  "validation_failed",
  "cancelled",
  "expired",
]);

export const installationRestoreRequestsTable = pgTable(
  "installation_restore_requests",
  {
    id: serial("id").primaryKey(),
    installationId: integer("installation_id")
      .notNull()
      .references(() => installationsTable.id, { onDelete: "restrict" }),
    // Snapshotted at submission. The installation's environment could in
    // principle be edited later; what was approved was a restore of a
    // PRODUCTION installation, and that fact must not drift.
    environmentSnapshot: text("environment_snapshot").notNull(),
    purpose: restorePurposeEnum("purpose").notNull(),
    status: restoreRequestStatusEnum("status").notNull().default("submitted"),

    // --- Restore point (exactly one of these is meaningful per type) ---
    restorePointType: restorePointTypeEnum("restore_point_type").notNull(),
    backupRunId: integer("backup_run_id").references(() => installationBackupRunsTable.id, { onDelete: "restrict" }),
    pitrTimestamp: timestamp("pitr_timestamp", { withTimezone: true }),
    /** Opaque provider identifier. Never a credential, never a URL carrying a token. */
    providerReference: text("provider_reference"),
    /** The recovery point this restore would return the installation to. */
    recoveryPointAt: timestamp("recovery_point_at", { withTimezone: true }),

    // --- Risk: completeness ---
    completeness: restoreCompletenessEnum("completeness").notNull(),
    /** Which components are not known-covered, e.g. ["binary_storage"]. */
    incompleteComponents: jsonb("incomplete_components"),
    /**
     * Risk ACCEPTANCE, not a dismissed warning. Restoring from a partial point
     * is blocked unless the requester explicitly acknowledged which component
     * is missing, and that acknowledgement is immutable and visible to the
     * approver.
     */
    incompleteAcknowledgedAt: timestamp("incomplete_acknowledged_at", { withTimezone: true }),
    incompleteAcknowledgementNote: text("incomplete_acknowledgement_note"),

    // --- Risk: pre-restore checkpoint ---
    preRestoreCheckpointState: preRestoreCheckpointEnum("pre_restore_checkpoint_state").notNull(),
    preRestoreBackupRunId: integer("pre_restore_backup_run_id").references(() => installationBackupRunsTable.id, {
      onDelete: "set null",
    }),
    preRestoreExceptionNote: text("pre_restore_exception_note"),

    // --- Quiescence ---
    quiescenceState: quiescenceStateEnum("quiescence_state").notNull().default("not_required"),
    quiescenceConfirmedByUserId: integer("quiescence_confirmed_by_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    quiescenceConfirmedAt: timestamp("quiescence_confirmed_at", { withTimezone: true }),
    quiescenceEvidence: text("quiescence_evidence"),

    // --- Blast radius ---
    /**
     * The organization ids the requester was shown, frozen at submission. Not
     * tenant data and not a foreign key: it is EVIDENCE of what blast radius a
     * human consented to. Re-derived at approval and again at dispatch, and a
     * change invalidates approval — an approver approved a blast radius, not an
     * identifier.
     */
    affectedOrganizationIdsSnapshot: jsonb("affected_organization_ids_snapshot").notNull(),

    reason: text("reason").notNull(),
    /** Evidence that the exact target-bound phrase was typed. Never the raw phrase. */
    confirmationVerifiedAt: timestamp("confirmation_verified_at", { withTimezone: true }).notNull(),

    requestedByUserId: integer("requested_by_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }),
    statusDetail: text("status_detail"),

    // --- Drift markers, captured at submission and compared before dispatch ---
    applicationVersionAtRequest: text("application_version_at_request"),
    gitCommitAtRequest: text("git_commit_at_request"),
    migrationVersionAtRequest: text("migration_version_at_request"),
    /**
     * Set when non-invalidating drift (a new deployment, say) occurred after
     * approval: the approval stands, but the operator must re-acknowledge the
     * current operational state before dispatch.
     */
    driftAcknowledgedAt: timestamp("drift_acknowledged_at", { withTimezone: true }),
  },
  (table) => [
    index("installation_restore_requests_installation_idx").on(table.installationId, table.submittedAt),
    index("installation_restore_requests_status_idx").on(table.status),
  ],
);

/**
 * APPEND-ONLY approval evidence, and a separate table on purpose.
 *
 * Fields on the request would be overwritten as it moved on, destroying exactly
 * the record that maker-checker exists to produce. A rejection is evidence too,
 * and an approval that was later invalidated by drift still happened.
 */
export const restoreDecisionEnum = pgEnum("restore_decision", ["approved", "rejected"]);

export const installationRestoreApprovalsTable = pgTable(
  "installation_restore_approvals",
  {
    id: serial("id").primaryKey(),
    requestId: integer("request_id")
      .notNull()
      .references(() => installationRestoreRequestsTable.id, { onDelete: "restrict" }),
    decision: restoreDecisionEnum("decision").notNull(),
    approverUserId: integer("approver_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
    comment: text("comment"),
    /** What the approver actually saw, frozen — blast radius and both risk acceptances. */
    affectedOrganizationIdsAtDecision: jsonb("affected_organization_ids_at_decision").notNull(),
    completenessAtDecision: restoreCompletenessEnum("completeness_at_decision").notNull(),
    preRestoreCheckpointAtDecision: preRestoreCheckpointEnum("pre_restore_checkpoint_at_decision").notNull(),
    /**
     * Policy-driven only. NULL means no expiry policy applies — never a
     * fabricated default duration.
     */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    /** Set when drift invalidated this approval. The row itself is never rewritten. */
    invalidatedAt: timestamp("invalidated_at", { withTimezone: true }),
    invalidationReason: text("invalidation_reason"),
  },
  (table) => [index("installation_restore_approvals_request_idx").on(table.requestId, table.decidedAt)],
);

export const restoreExecutionStatusEnum = pgEnum("installation_restore_execution_status", [
  "dispatched",
  "accepted",
  "started",
  "succeeded",
  "failed",
]);

/**
 * APPEND-ONLY execution evidence. A retry creates a SECOND attempt rather than
 * overwriting the first: a failed restore attempt is operational history that
 * must survive, and rewriting it into a success would erase the fact that
 * something went wrong on production infrastructure.
 */
export const installationRestoreExecutionsTable = pgTable(
  "installation_restore_executions",
  {
    id: serial("id").primaryKey(),
    requestId: integer("request_id")
      .notNull()
      .references(() => installationRestoreRequestsTable.id, { onDelete: "restrict" }),
    attemptNumber: integer("attempt_number").notNull(),
    status: restoreExecutionStatusEnum("status").notNull().default("dispatched"),
    /**
     * Makes dispatch idempotent. A repeated request — a double-click, a retried
     * HTTP call — must never start a second physical restore.
     */
    idempotencyKey: text("idempotency_key").notNull(),
    dispatchedByUserId: integer("dispatched_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    executorType: text("executor_type"),
    externalReference: text("external_reference"),
    failureCategory: text("failure_category"),
    /** Set only when the executor genuinely supports cancellation. Never a claim we stopped it. */
    cancellationRequestedAt: timestamp("cancellation_requested_at", { withTimezone: true }),
    statusDetail: text("status_detail"),
  },
  (table) => [
    uniqueIndex("installation_restore_executions_idempotency_unique").on(table.idempotencyKey),
    uniqueIndex("installation_restore_executions_attempt_unique").on(table.requestId, table.attemptNumber),
  ],
);

export const validationCheckResultEnum = pgEnum("restore_validation_result", [
  "passed",
  "failed",
  "unknown",
  "not_applicable",
]);

/** Automated evidence and human attestation are kept visibly distinct. */
export const validationSourceEnum = pgEnum("restore_validation_source", ["automated", "operator_attestation"]);

/**
 * APPEND-ONLY post-restore validation.
 *
 * EXECUTION SUCCESS IS NOT VALIDATION SUCCESS. The infrastructure reporting
 * that it finished says nothing about whether this application can actually
 * run on what came back — whether the schema matches the code, whether the
 * binaries and the database agree, whether anything is reachable. Those are
 * separate facts and are recorded separately.
 *
 * An operator attestation may never overturn an automated failure; it exists
 * only for checks no automation can perform in a given environment.
 */
export const installationRestoreValidationsTable = pgTable(
  "installation_restore_validations",
  {
    id: serial("id").primaryKey(),
    requestId: integer("request_id")
      .notNull()
      .references(() => installationRestoreRequestsTable.id, { onDelete: "restrict" }),
    executionId: integer("execution_id").references(() => installationRestoreExecutionsTable.id, {
      onDelete: "set null",
    }),
    /** e.g. database_reachable, migration_version, application_ready, storage_health, storage_reconciliation. */
    checkKey: text("check_key").notNull(),
    result: validationCheckResultEnum("result").notNull(),
    source: validationSourceEnum("source").notNull(),
    /** Operational aggregates only — never document titles, employee identities or object contents. */
    detail: text("detail"),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
    recordedByUserId: integer("recorded_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  },
  (table) => [index("installation_restore_validations_request_idx").on(table.requestId, table.observedAt)],
);

export const insertInstallationRestoreRequestSchema = createInsertSchema(installationRestoreRequestsTable).omit({ id: true });
export const insertInstallationRestoreApprovalSchema = createInsertSchema(installationRestoreApprovalsTable).omit({ id: true });
export const insertInstallationRestoreExecutionSchema = createInsertSchema(installationRestoreExecutionsTable).omit({ id: true });
export const insertInstallationRestoreValidationSchema = createInsertSchema(installationRestoreValidationsTable).omit({ id: true });

export type InstallationRestoreRequest = typeof installationRestoreRequestsTable.$inferSelect;
export type InstallationRestoreApproval = typeof installationRestoreApprovalsTable.$inferSelect;
export type InstallationRestoreExecution = typeof installationRestoreExecutionsTable.$inferSelect;
export type InstallationRestoreValidation = typeof installationRestoreValidationsTable.$inferSelect;
export type RestorePurpose = (typeof restorePurposeEnum.enumValues)[number];
export type RestoreCompleteness = (typeof restoreCompletenessEnum.enumValues)[number];
export type RestoreRequestStatus = (typeof restoreRequestStatusEnum.enumValues)[number];
export type PreRestoreCheckpointState = (typeof preRestoreCheckpointEnum.enumValues)[number];
export type QuiescenceState = (typeof quiescenceStateEnum.enumValues)[number];
export type InsertInstallationRestoreRequest = z.infer<typeof insertInstallationRestoreRequestSchema>;
