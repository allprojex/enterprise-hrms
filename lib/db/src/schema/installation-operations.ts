import { pgTable, serial, integer, text, bigint, timestamp, pgEnum, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { installationsTable } from "./installations";
import { usersTable } from "./users";

// WS-17 Slice 1 — installation operational records: deployment history, backup
// policy, backup requests and backup evidence.
//
// EVERY TABLE HERE IS INSTALLATION-SCOPED, AND NONE CARRIES organizationId.
//
// That is the load-bearing decision. One shared installation may serve many
// organizations, so one deployment is ONE deployment, one backup is ONE backup,
// and one health condition is ONE condition. Affected tenants are derived
// through `installation_organizations`. Attaching an organizationId here would
// fabricate per-tenant operational events that never physically happened —
// three backup rows for one `pg_dump` — and that lie would then be reported to
// customers as fact.
//
// THE HRMS RECORDS; INFRASTRUCTURE EXECUTES.
//
// Nothing in this schema implies the application performs a deployment or a
// backup. `pg_dump`, PITR, provider snapshots, volume backups and object-store
// replication happen in the infrastructure plane. These tables hold policy,
// requests, and evidence reported back. There is no command, no script, no
// credential and no shell anywhere in this model.

// --- Deployment history ----------------------------------------------------

/** Where a piece of operational evidence came from. Provenance, never authority. */
export const operationalExecutorTypeEnum = pgEnum("operational_executor_type", [
  "operator",
  "ci_cd",
  "installation_agent",
  "provider",
  "imported_evidence",
]);

export const deploymentResultEnum = pgEnum("installation_deployment_result", [
  "in_progress",
  "succeeded",
  "failed",
  "rolled_back",
]);

/**
 * Append-only deployment evidence. `installations` keeps the CURRENT version
 * columns it already shipped with; this is the series behind them, so there is
 * one current-state truth and one history, never two competing currents.
 *
 * Only a `succeeded` row may advance the installation's current state — a
 * failed deployment must never make the version it tried to install look live.
 */
export const installationDeploymentsTable = pgTable(
  "installation_deployments",
  {
    id: serial("id").primaryKey(),
    installationId: integer("installation_id")
      .notNull()
      .references(() => installationsTable.id, { onDelete: "restrict" }),
    applicationVersion: text("application_version"),
    gitCommit: text("git_commit"),
    migrationVersion: text("migration_version"),
    // What the installation was on before this attempt, captured at record
    // time so history reads without needing to reconstruct order.
    previousApplicationVersion: text("previous_application_version"),
    previousGitCommit: text("previous_git_commit"),
    result: deploymentResultEnum("result").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    executorType: operationalExecutorTypeEnum("executor_type").notNull(),
    /** Opaque external reference — a pipeline run id, never a credential or URL with a token. */
    externalReference: text("external_reference"),
    /** The deployment this one rolled back to, when it is a rollback. */
    rolledBackFromDeploymentId: integer("rolled_back_from_deployment_id"),
    /** Operator notes. Never secrets, never customer data. */
    notes: text("notes"),
    recordedByUserId: integer("recorded_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("installation_deployments_installation_idx").on(table.installationId, table.recordedAt),
  ],
);

// --- Backup policy ---------------------------------------------------------

export const backupStrategyEnum = pgEnum("installation_backup_strategy", [
  "provider_managed",
  "logical_dump",
  "volume_snapshot",
  "mixed",
]);

/**
 * How a component of the recovery surface is protected. `unknown` is a
 * first-class answer and the DEFAULT: the storage durability work established
 * that a database backup does not protect authoritative binaries, so coverage
 * must be stated rather than inferred. An installation that has never told us
 * about its binary storage is `unknown`, never `covered`.
 */
export const backupCoverageEnum = pgEnum("installation_backup_coverage", ["covered", "not_covered", "unknown"]);

/**
 * TARGET, not observation. Everything here is what the installation is
 * *expected* to achieve; what actually happened lives in
 * `installation_backup_runs`. Keeping them in separate tables is what stops
 * "we configured an RPO" from being read as "we met an RPO".
 *
 * RPO/RTO are nullable on purpose. There is no default SLA, because inventing
 * one would give a fabricated number the authority of a commitment.
 */
export const installationBackupPoliciesTable = pgTable(
  "installation_backup_policies",
  {
    id: serial("id").primaryKey(),
    installationId: integer("installation_id")
      .notNull()
      .references(() => installationsTable.id, { onDelete: "restrict" })
      .unique(),
    enabled: integer("enabled").notNull().default(1),
    strategy: backupStrategyEnum("strategy"),
    /** Expected cadence. Null = no cadence expectation, so nothing is ever "overdue". */
    expectedFrequencyHours: integer("expected_frequency_hours"),
    /** Configured targets only. Null means unconfigured, which is valid and honest. */
    targetRpoMinutes: integer("target_rpo_minutes"),
    targetRtoMinutes: integer("target_rto_minutes"),
    /** A human/operational reference to the retention policy — never a fabricated duration. */
    retentionPolicyReference: text("retention_policy_reference"),
    databaseCoverage: backupCoverageEnum("database_coverage").notNull().default("unknown"),
    binaryStorageCoverage: backupCoverageEnum("binary_storage_coverage").notNull().default("unknown"),
    /** Who actually performs backups for this installation. */
    executorType: operationalExecutorTypeEnum("executor_type"),
    /** True when this installation's executor accepts backup requests from the control plane. */
    supportsBackupRequests: integer("supports_backup_requests").notNull().default(0),
    updatedByUserId: integer("updated_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
);

// --- Backup requests -------------------------------------------------------

/**
 * A REQUEST is not a backup. These states exist so that "we asked" can never be
 * displayed as "it happened": only an `installation_backup_runs` row is
 * evidence, and a request reaching `succeeded` means the executor said so, with
 * the run carrying the detail.
 */
export const backupRequestStatusEnum = pgEnum("installation_backup_request_status", [
  "requested",
  "accepted",
  "executing",
  "succeeded",
  "failed",
  "rejected",
  "cancelled",
]);

export const installationBackupRequestsTable = pgTable(
  "installation_backup_requests",
  {
    id: serial("id").primaryKey(),
    installationId: integer("installation_id")
      .notNull()
      .references(() => installationsTable.id, { onDelete: "restrict" }),
    status: backupRequestStatusEnum("status").notNull().default("requested"),
    backupType: backupStrategyEnum("backup_type"),
    reason: text("reason").notNull(),
    requestedByUserId: integer("requested_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }),
    /** Opaque executor-side identifier. Never a credential. */
    externalReference: text("external_reference"),
    statusDetail: text("status_detail"),
  },
  (table) => [
    index("installation_backup_requests_installation_idx").on(table.installationId, table.requestedAt),
  ],
);

// --- Backup runs / evidence ------------------------------------------------

export const backupRunResultEnum = pgEnum("installation_backup_run_result", ["succeeded", "partial", "failed"]);

export const backupComponentResultEnum = pgEnum("installation_backup_component_result", [
  "succeeded",
  "failed",
  "not_attempted",
  "unknown",
]);

/**
 * Append-only evidence that a backup actually occurred.
 *
 * Component results are recorded SEPARATELY and neither is inferred from the
 * other. A `succeeded` database component with an `unknown` binary component is
 * exactly that — not a complete backup — because the storage durability work
 * proved a PostgreSQL backup does not protect the uploads. `result` is
 * `partial` in that case, and Fleet Health treats it accordingly.
 *
 * Corrections append a NEW row referencing the one they supersede rather than
 * rewriting history: an outcome that was reported once must remain readable as
 * what was reported then.
 */
export const installationBackupRunsTable = pgTable(
  "installation_backup_runs",
  {
    id: serial("id").primaryKey(),
    installationId: integer("installation_id")
      .notNull()
      .references(() => installationsTable.id, { onDelete: "restrict" }),
    requestId: integer("request_id").references(() => installationBackupRequestsTable.id, { onDelete: "set null" }),
    backupType: backupStrategyEnum("backup_type"),
    result: backupRunResultEnum("result").notNull(),
    databaseResult: backupComponentResultEnum("database_result").notNull().default("unknown"),
    binaryStorageResult: backupComponentResultEnum("binary_storage_result").notNull().default("unknown"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    /** The point in time the backup can restore TO — not when it finished running. */
    recoveryPointAt: timestamp("recovery_point_at", { withTimezone: true }),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    executorType: operationalExecutorTypeEnum("executor_type").notNull(),
    externalReference: text("external_reference"),
    /** A category, not a stack trace, and never provider output containing secrets. */
    failureCategory: text("failure_category"),
    /** When the control plane learned of this, as opposed to when it happened. */
    evidenceReceivedAt: timestamp("evidence_received_at", { withTimezone: true }).notNull().defaultNow(),
    recordedByUserId: integer("recorded_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    /** Set when this row corrects an earlier report. History is appended, never rewritten. */
    supersedesRunId: integer("supersedes_run_id"),
  },
  (table) => [
    index("installation_backup_runs_installation_idx").on(table.installationId, table.recoveryPointAt),
    index("installation_backup_runs_installation_received_idx").on(table.installationId, table.evidenceReceivedAt),
  ],
);

// --- Telemetry (current state only) ----------------------------------------

/**
 * ONE ROW PER INSTALLATION, updated in place — deliberately not a snapshot
 * lake. Fleet Health needs "what is true now"; an unbounded high-frequency
 * event stream would grow fastest of anything in the platform and would then
 * need a destructive retention job, which no approved policy authorizes.
 * Meaningful history already lives in the deployment and backup evidence
 * tables, which are the records that matter operationally.
 *
 * Absence of a row means UNKNOWN. A stale `observedAt` means STALE. Neither
 * ever means healthy.
 */
export const installationTelemetryTable = pgTable(
  "installation_telemetry",
  {
    id: serial("id").primaryKey(),
    installationId: integer("installation_id")
      .notNull()
      .references(() => installationsTable.id, { onDelete: "restrict" })
      .unique(),
    /** When the reported state was true at the installation, not when we stored it. */
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    reportedApplicationVersion: text("reported_application_version"),
    reportedGitCommit: text("reported_git_commit"),
    reportedMigrationVersion: text("reported_migration_version"),
    /** Liveness/readiness as the installation reported them. Null = not reported. */
    applicationHealthy: integer("application_healthy"),
    databaseReady: integer("database_ready"),
    /** Storage backend kind and health, as aggregates only — never object detail. */
    storageBackend: text("storage_backend"),
    storageHealthy: integer("storage_healthy"),
    executorType: operationalExecutorTypeEnum("executor_type").notNull(),
    recordedByUserId: integer("recorded_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
);

export const insertInstallationDeploymentSchema = createInsertSchema(installationDeploymentsTable).omit({ id: true });
export const insertInstallationBackupPolicySchema = createInsertSchema(installationBackupPoliciesTable).omit({ id: true });
export const insertInstallationBackupRequestSchema = createInsertSchema(installationBackupRequestsTable).omit({ id: true });
export const insertInstallationBackupRunSchema = createInsertSchema(installationBackupRunsTable).omit({ id: true });
export const insertInstallationTelemetrySchema = createInsertSchema(installationTelemetryTable).omit({ id: true });

export type InstallationDeployment = typeof installationDeploymentsTable.$inferSelect;
export type InstallationBackupPolicy = typeof installationBackupPoliciesTable.$inferSelect;
export type InstallationBackupRequest = typeof installationBackupRequestsTable.$inferSelect;
export type InstallationBackupRun = typeof installationBackupRunsTable.$inferSelect;
export type InstallationTelemetry = typeof installationTelemetryTable.$inferSelect;
export type InsertInstallationDeployment = z.infer<typeof insertInstallationDeploymentSchema>;
export type BackupCoverage = (typeof backupCoverageEnum.enumValues)[number];
export type BackupComponentResult = (typeof backupComponentResultEnum.enumValues)[number];
export type OperationalExecutorType = (typeof operationalExecutorTypeEnum.enumValues)[number];
