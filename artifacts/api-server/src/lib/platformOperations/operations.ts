/**
 * WS-17 Slice 1 — installation operational services: deployment evidence,
 * backup policy, backup requests, backup evidence, and telemetry.
 *
 * THE HRMS RECORDS AND GOVERNS. INFRASTRUCTURE EXECUTES.
 *
 * Nothing here runs `pg_dump`, triggers a snapshot, deploys a build or reaches
 * a host. There is no command, no script, no SSH and no provider credential in
 * this module, and none may be added: a control plane that can execute
 * arbitrary infrastructure actions is a remote shell wearing a governance
 * costume. What these functions do is record policy, record a request, and
 * record evidence that an external executor reported.
 *
 * Everything is INSTALLATION-scoped. Affected organizations are derived through
 * `installation_organizations`, never duplicated per tenant.
 */
import { and, desc, eq, isNull } from "drizzle-orm";
import {
  db,
  installationsTable,
  installationOrganizationsTable,
  organizationsTable,
  installationDeploymentsTable,
  installationBackupPoliciesTable,
  installationBackupRequestsTable,
  installationBackupRunsTable,
  installationTelemetryTable,
  type InstallationDeployment,
  type InstallationBackupPolicy,
  type InstallationBackupRequest,
  type InstallationBackupRun,
  type InstallationTelemetry,
  type OperationalExecutorType,
} from "@workspace/db";
import { recordAuditEvent } from "../auditLog";
import { classifyOperation, auditScopeMetadata } from "./blastRadius";

export class InstallationNotFoundError extends Error {
  constructor() {
    super("Installation not found");
    this.name = "InstallationNotFoundError";
  }
}
export class InvalidOperationalStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidOperationalStateError";
  }
}

export interface OperationActor {
  userId: number | null;
}

async function requireInstallation(installationId: number) {
  const [row] = await db.select().from(installationsTable).where(eq(installationsTable.id, installationId));
  if (!row) throw new InstallationNotFoundError();
  return row;
}

/** The organizations a platform event affects, derived — never stored per event. */
export async function listAffectedOrganizations(
  installationId: number,
): Promise<{ organizationId: number; name: string }[]> {
  return db
    .select({ organizationId: organizationsTable.id, name: organizationsTable.name })
    .from(installationOrganizationsTable)
    .innerJoin(organizationsTable, eq(installationOrganizationsTable.organizationId, organizationsTable.id))
    .where(
      and(
        eq(installationOrganizationsTable.installationId, installationId),
        isNull(installationOrganizationsTable.unlinkedAt),
      ),
    );
}

// --- Deployment evidence ---------------------------------------------------

export interface RecordDeploymentParams {
  installationId: number;
  applicationVersion?: string | null;
  gitCommit?: string | null;
  migrationVersion?: string | null;
  result: "in_progress" | "succeeded" | "failed" | "rolled_back";
  startedAt?: Date | null;
  completedAt?: Date | null;
  executorType: OperationalExecutorType;
  externalReference?: string | null;
  rolledBackFromDeploymentId?: number | null;
  notes?: string | null;
  actor: OperationActor;
}

/**
 * Records a deployment that an external system performed, and — only for a
 * SUCCEEDED deployment — advances the installation's current-state columns.
 *
 * The asymmetry is the point. A failed deployment must never make the version
 * it tried to install look live, so `installations.applicationVersion` moves
 * only on success. That keeps one current truth (the registry) and one history
 * (this table) instead of two competing answers.
 *
 * `executorType` is PROVENANCE, not authority: it says where evidence came
 * from. Authority came from the platform grant that let the caller in.
 */
export async function recordDeployment(params: RecordDeploymentParams): Promise<InstallationDeployment> {
  const installation = await requireInstallation(params.installationId);

  const record = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(installationDeploymentsTable)
      .values({
        installationId: params.installationId,
        applicationVersion: params.applicationVersion ?? null,
        gitCommit: params.gitCommit ?? null,
        migrationVersion: params.migrationVersion ?? null,
        previousApplicationVersion: installation.applicationVersion,
        previousGitCommit: installation.gitCommit,
        result: params.result,
        startedAt: params.startedAt ?? null,
        completedAt: params.completedAt ?? null,
        executorType: params.executorType,
        externalReference: params.externalReference ?? null,
        rolledBackFromDeploymentId: params.rolledBackFromDeploymentId ?? null,
        notes: params.notes ?? null,
        recordedByUserId: params.actor.userId,
      })
      .returning();

    if (params.result === "succeeded") {
      await tx
        .update(installationsTable)
        .set({
          applicationVersion: params.applicationVersion ?? installation.applicationVersion,
          gitCommit: params.gitCommit ?? installation.gitCommit,
          migrationVersion: params.migrationVersion ?? installation.migrationVersion,
          deployedAt: params.completedAt ?? new Date(),
        })
        .where(eq(installationsTable.id, params.installationId));
    }

    return created;
  });

  await recordAuditEvent({
    actorApplicationUserId: params.actor.userId,
    organizationId: null, // platform-scoped: this event belongs to an installation
    eventType: "platform_deployment.recorded",
    targetType: "installation_deployment",
    targetId: String(record.id),
    metadata: auditScopeMetadata(
      classifyOperation("installation.deployment.record", { installationId: params.installationId }),
    ),
    afterState: {
      installationId: params.installationId,
      result: params.result,
      applicationVersion: record.applicationVersion,
      gitCommit: record.gitCommit,
      executorType: params.executorType,
      advancedCurrentState: params.result === "succeeded",
    },
  });

  return record;
}

export async function listDeployments(installationId: number, limit = 50): Promise<InstallationDeployment[]> {
  return db
    .select()
    .from(installationDeploymentsTable)
    .where(eq(installationDeploymentsTable.installationId, installationId))
    .orderBy(desc(installationDeploymentsTable.recordedAt))
    .limit(limit);
}

// --- Backup policy ---------------------------------------------------------

export interface UpsertBackupPolicyParams {
  installationId: number;
  enabled?: boolean;
  strategy?: InstallationBackupPolicy["strategy"];
  expectedFrequencyHours?: number | null;
  targetRpoMinutes?: number | null;
  targetRtoMinutes?: number | null;
  retentionPolicyReference?: string | null;
  databaseCoverage?: InstallationBackupPolicy["databaseCoverage"];
  binaryStorageCoverage?: InstallationBackupPolicy["binaryStorageCoverage"];
  executorType?: OperationalExecutorType | null;
  supportsBackupRequests?: boolean;
  actor: OperationActor;
}

/**
 * Creates or updates an installation's backup TARGET.
 *
 * Nothing here is an observation. Populating `targetRpoMinutes` records an
 * intention, never a claim that it is met — that determination needs evidence,
 * and evidence lives in `installation_backup_runs`. Both RPO and RTO stay
 * nullable because unconfigured is a truthful state and a fabricated default
 * would carry the weight of a promise nobody made.
 */
export async function upsertBackupPolicy(params: UpsertBackupPolicyParams): Promise<InstallationBackupPolicy> {
  await requireInstallation(params.installationId);

  const [existing] = await db
    .select()
    .from(installationBackupPoliciesTable)
    .where(eq(installationBackupPoliciesTable.installationId, params.installationId));

  const values = {
    enabled: params.enabled === undefined ? undefined : params.enabled ? 1 : 0,
    strategy: params.strategy,
    expectedFrequencyHours: params.expectedFrequencyHours,
    targetRpoMinutes: params.targetRpoMinutes,
    targetRtoMinutes: params.targetRtoMinutes,
    retentionPolicyReference: params.retentionPolicyReference,
    databaseCoverage: params.databaseCoverage,
    binaryStorageCoverage: params.binaryStorageCoverage,
    executorType: params.executorType,
    supportsBackupRequests:
      params.supportsBackupRequests === undefined ? undefined : params.supportsBackupRequests ? 1 : 0,
    updatedByUserId: params.actor.userId,
  };
  const defined = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined));

  const [row] = existing
    ? await db
        .update(installationBackupPoliciesTable)
        .set(defined)
        .where(eq(installationBackupPoliciesTable.id, existing.id))
        .returning()
    : await db
        .insert(installationBackupPoliciesTable)
        .values({ installationId: params.installationId, ...defined })
        .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actor.userId,
    organizationId: null,
    eventType: existing ? "platform_backup_policy.updated" : "platform_backup_policy.created",
    targetType: "installation_backup_policy",
    targetId: String(row.id),
    metadata: auditScopeMetadata(classifyOperation("installation.backup.policy", { installationId: params.installationId })),
    beforeState: existing
      ? {
          targetRpoMinutes: existing.targetRpoMinutes,
          targetRtoMinutes: existing.targetRtoMinutes,
          databaseCoverage: existing.databaseCoverage,
          binaryStorageCoverage: existing.binaryStorageCoverage,
        }
      : null,
    afterState: {
      installationId: params.installationId,
      targetRpoMinutes: row.targetRpoMinutes,
      targetRtoMinutes: row.targetRtoMinutes,
      databaseCoverage: row.databaseCoverage,
      binaryStorageCoverage: row.binaryStorageCoverage,
    },
  });

  return row;
}

export async function getBackupPolicy(installationId: number): Promise<InstallationBackupPolicy | null> {
  const [row] = await db
    .select()
    .from(installationBackupPoliciesTable)
    .where(eq(installationBackupPoliciesTable.installationId, installationId));
  return row ?? null;
}

// --- Backup requests -------------------------------------------------------

const REQUEST_TRANSITIONS: Record<InstallationBackupRequest["status"], readonly InstallationBackupRequest["status"][]> =
  {
    requested: ["accepted", "rejected", "cancelled"],
    accepted: ["executing", "failed", "cancelled"],
    executing: ["succeeded", "failed"],
    succeeded: [],
    failed: [],
    rejected: [],
    cancelled: [],
  };

/**
 * Asks an executor to take a backup. This is a REQUEST — it is not a backup,
 * and reaching `succeeded` here still is not evidence: only an
 * `installation_backup_runs` row is evidence. The two are separate tables so
 * that "we asked" can never be rendered as "it happened".
 *
 * Refused when the installation's policy does not declare that its executor
 * accepts requests, because a request nothing will ever collect is a promise
 * the control plane cannot keep.
 */
export async function requestBackup(params: {
  installationId: number;
  reason: string;
  backupType?: InstallationBackupRequest["backupType"];
  actor: OperationActor;
}): Promise<InstallationBackupRequest> {
  await requireInstallation(params.installationId);
  const reason = params.reason?.trim() ?? "";
  if (!reason) throw new InvalidOperationalStateError("A reason is required to request a backup");

  const policy = await getBackupPolicy(params.installationId);
  if (!policy || policy.supportsBackupRequests !== 1) {
    throw new InvalidOperationalStateError(
      "This installation's backup executor does not accept requests from the control plane",
    );
  }

  const [row] = await db
    .insert(installationBackupRequestsTable)
    .values({
      installationId: params.installationId,
      reason,
      backupType: params.backupType ?? policy.strategy ?? null,
      requestedByUserId: params.actor.userId,
      status: "requested",
    })
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actor.userId,
    organizationId: null,
    eventType: "platform_backup_request.created",
    targetType: "installation_backup_request",
    targetId: String(row.id),
    metadata: auditScopeMetadata(classifyOperation("installation.backup.request", { installationId: params.installationId })),
    afterState: { installationId: params.installationId, reason, status: row.status },
  });

  return row;
}

/** Moves a request along its state machine. Illegal transitions are refused, never silently applied. */
export async function updateBackupRequestStatus(params: {
  requestId: number;
  status: InstallationBackupRequest["status"];
  externalReference?: string | null;
  statusDetail?: string | null;
  actor: OperationActor;
}): Promise<InstallationBackupRequest> {
  const [existing] = await db
    .select()
    .from(installationBackupRequestsTable)
    .where(eq(installationBackupRequestsTable.id, params.requestId));
  if (!existing) throw new InvalidOperationalStateError("Backup request not found");

  const allowed = REQUEST_TRANSITIONS[existing.status];
  if (!allowed.includes(params.status)) {
    throw new InvalidOperationalStateError(`Cannot move a backup request from ${existing.status} to ${params.status}`);
  }

  const [row] = await db
    .update(installationBackupRequestsTable)
    .set({
      status: params.status,
      statusChangedAt: new Date(),
      externalReference: params.externalReference ?? existing.externalReference,
      statusDetail: params.statusDetail ?? existing.statusDetail,
    })
    .where(eq(installationBackupRequestsTable.id, params.requestId))
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actor.userId,
    organizationId: null,
    eventType: "platform_backup_request.status_changed",
    targetType: "installation_backup_request",
    targetId: String(params.requestId),
    beforeState: { status: existing.status },
    afterState: { status: row.status },
  });

  return row;
}

export async function listBackupRequests(installationId: number, limit = 50): Promise<InstallationBackupRequest[]> {
  return db
    .select()
    .from(installationBackupRequestsTable)
    .where(eq(installationBackupRequestsTable.installationId, installationId))
    .orderBy(desc(installationBackupRequestsTable.requestedAt))
    .limit(limit);
}

// --- Backup evidence -------------------------------------------------------

export interface RecordBackupRunParams {
  installationId: number;
  requestId?: number | null;
  backupType?: InstallationBackupRun["backupType"];
  databaseResult: InstallationBackupRun["databaseResult"];
  binaryStorageResult: InstallationBackupRun["binaryStorageResult"];
  startedAt?: Date | null;
  completedAt?: Date | null;
  recoveryPointAt?: Date | null;
  sizeBytes?: number | null;
  executorType: OperationalExecutorType;
  externalReference?: string | null;
  failureCategory?: string | null;
  supersedesRunId?: number | null;
  actor: OperationActor;
}

/**
 * The overall result is DERIVED from the components, never supplied by the
 * caller. This is the single most important rule in this module: it makes it
 * impossible to report "backup succeeded" when only the database was
 * protected. The storage durability work established that authoritative
 * binaries live outside PostgreSQL, so a database-only success is `partial` —
 * and an `unknown` binary component is also `partial`, because not knowing is
 * not the same as being covered.
 */
export function deriveBackupRunResult(
  databaseResult: InstallationBackupRun["databaseResult"],
  binaryStorageResult: InstallationBackupRun["binaryStorageResult"],
): InstallationBackupRun["result"] {
  if (databaseResult === "failed" || binaryStorageResult === "failed") return "failed";
  if (databaseResult === "succeeded" && binaryStorageResult === "succeeded") return "succeeded";
  return "partial";
}

/** Append-only. A correction is a NEW row pointing at what it supersedes. */
export async function recordBackupRun(params: RecordBackupRunParams): Promise<InstallationBackupRun> {
  await requireInstallation(params.installationId);

  const result = deriveBackupRunResult(params.databaseResult, params.binaryStorageResult);

  const [row] = await db
    .insert(installationBackupRunsTable)
    .values({
      installationId: params.installationId,
      requestId: params.requestId ?? null,
      backupType: params.backupType ?? null,
      result,
      databaseResult: params.databaseResult,
      binaryStorageResult: params.binaryStorageResult,
      startedAt: params.startedAt ?? null,
      completedAt: params.completedAt ?? null,
      recoveryPointAt: params.recoveryPointAt ?? null,
      sizeBytes: params.sizeBytes ?? null,
      executorType: params.executorType,
      externalReference: params.externalReference ?? null,
      failureCategory: params.failureCategory ?? null,
      supersedesRunId: params.supersedesRunId ?? null,
      recordedByUserId: params.actor.userId,
    })
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actor.userId,
    organizationId: null,
    eventType: "platform_backup_run.recorded",
    targetType: "installation_backup_run",
    targetId: String(row.id),
    metadata: auditScopeMetadata(classifyOperation("installation.backup.run", { installationId: params.installationId })),
    afterState: {
      installationId: params.installationId,
      result,
      databaseResult: params.databaseResult,
      binaryStorageResult: params.binaryStorageResult,
      supersedesRunId: params.supersedesRunId ?? null,
    },
  });

  return row;
}

export async function listBackupRuns(installationId: number, limit = 50): Promise<InstallationBackupRun[]> {
  return db
    .select()
    .from(installationBackupRunsTable)
    .where(eq(installationBackupRunsTable.installationId, installationId))
    .orderBy(desc(installationBackupRunsTable.evidenceReceivedAt))
    .limit(limit);
}

/**
 * The most recent run that has not been superseded by a later correction.
 * Reading the latest row alone would show a report that has since been
 * corrected as if it still stood.
 */
export async function getLatestBackupRun(installationId: number): Promise<InstallationBackupRun | null> {
  const rows = await listBackupRuns(installationId, 200);
  const superseded = new Set(rows.map((r) => r.supersedesRunId).filter((v): v is number => v !== null));
  return rows.find((r) => !superseded.has(r.id)) ?? null;
}

// --- Telemetry -------------------------------------------------------------

export interface RecordTelemetryParams {
  installationId: number;
  observedAt: Date;
  reportedApplicationVersion?: string | null;
  reportedGitCommit?: string | null;
  reportedMigrationVersion?: string | null;
  applicationHealthy?: boolean | null;
  databaseReady?: boolean | null;
  storageBackend?: string | null;
  storageHealthy?: boolean | null;
  executorType: OperationalExecutorType;
  actor: OperationActor;
}

/**
 * Records current telemetry for an installation, replacing the previous row.
 *
 * Current-state only, deliberately: an unbounded snapshot stream would be the
 * fastest-growing table on the platform and would then need destructive
 * pruning that no approved retention policy authorizes. Operationally
 * meaningful history already exists in the deployment and backup evidence
 * tables, which are append-only.
 *
 * Out-of-order reports are ignored rather than applied — a replayed or delayed
 * message must not overwrite fresher truth with older truth.
 */
export async function recordTelemetry(params: RecordTelemetryParams): Promise<InstallationTelemetry> {
  await requireInstallation(params.installationId);

  const [existing] = await db
    .select()
    .from(installationTelemetryTable)
    .where(eq(installationTelemetryTable.installationId, params.installationId));

  if (existing && existing.observedAt >= params.observedAt) return existing;

  const values = {
    observedAt: params.observedAt,
    reportedApplicationVersion: params.reportedApplicationVersion ?? null,
    reportedGitCommit: params.reportedGitCommit ?? null,
    reportedMigrationVersion: params.reportedMigrationVersion ?? null,
    applicationHealthy: params.applicationHealthy == null ? null : params.applicationHealthy ? 1 : 0,
    databaseReady: params.databaseReady == null ? null : params.databaseReady ? 1 : 0,
    storageBackend: params.storageBackend ?? null,
    storageHealthy: params.storageHealthy == null ? null : params.storageHealthy ? 1 : 0,
    executorType: params.executorType,
    recordedByUserId: params.actor.userId,
  };

  const [row] = existing
    ? await db
        .update(installationTelemetryTable)
        .set(values)
        .where(eq(installationTelemetryTable.id, existing.id))
        .returning()
    : await db
        .insert(installationTelemetryTable)
        .values({ installationId: params.installationId, ...values })
        .returning();

  return row;
}

export async function getTelemetry(installationId: number): Promise<InstallationTelemetry | null> {
  const [row] = await db
    .select()
    .from(installationTelemetryTable)
    .where(eq(installationTelemetryTable.installationId, installationId));
  return row ?? null;
}
