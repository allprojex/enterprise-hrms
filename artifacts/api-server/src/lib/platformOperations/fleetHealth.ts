/**
 * WS-17 Slice 1 — Fleet Health.
 *
 * EXPLICIT SIGNALS, NO COMPOSITE SCORE.
 *
 * There is deliberately no "82% healthy" here. A weighted number would imply a
 * precision this platform cannot yet justify: most installations have no
 * telemetry at all, weights would be invented, and the resulting figure would
 * be arithmetic dressed as insight. An operator is far better served by
 * "backup evidence overdue" than by a number that hides which of six things is
 * wrong. Composite scoring waits until there are enough authoritative signals
 * and an approved weighting policy.
 *
 * UNKNOWN IS A FIRST-CLASS ANSWER, AND IT IS NOT HEALTHY.
 *
 * Every signal can be `unknown`, and absence of failure evidence never becomes
 * health. A customer-managed installation that has never reported is honestly
 * `unknown` — not green, and not red either, because "we cannot see it" is not
 * the same as "it is broken". It only becomes a problem when a configured
 * expectation is breached, which is why `stale` and `overdue` require a policy
 * to exist first.
 *
 * DERIVATION IS DETERMINISTIC. Every state below follows from recorded
 * evidence plus configured policy — nothing is guessed, and there is no manual
 * override anywhere in this module. An administrator cannot paint a signal
 * green; if evidence is absent, the surface says so.
 */
import { eq } from "drizzle-orm";
import { db, installationsTable, type Installation } from "@workspace/db";
import {
  getBackupPolicy,
  getLatestBackupRun,
  getTelemetry,
  listAffectedOrganizations,
} from "./operations";

/** How a single signal reads. `stale` is distinct from `unknown`: we heard once, but too long ago. */
export type HealthState = "healthy" | "degraded" | "unhealthy" | "unknown" | "stale";

export interface HealthSignal {
  key: string;
  state: HealthState;
  /** Plain operator-facing sentence. Never a stack trace, never infrastructure internals. */
  detail: string;
}

export interface InstallationHealth {
  installationId: number;
  installationKey: string;
  name: string;
  environmentType: Installation["environmentType"];
  hostingModel: Installation["hostingModel"];
  status: Installation["status"];
  currentApplicationVersion: string | null;
  currentGitCommit: string | null;
  currentMigrationVersion: string | null;
  deployedAt: Date | null;
  /** Worst of the signals — a summary, never a score. */
  overall: HealthState;
  signals: HealthSignal[];
  affectedOrganizations: { organizationId: number; name: string }[];
}

/**
 * How long without telemetry before it is stale. Twenty-five hours is not an
 * SLA and is not configurable policy — it is the threshold for describing a
 * DAILY reporter as overdue, with an hour of slack. It never turns a healthy
 * installation unhealthy; it only downgrades the telemetry signal to `stale`
 * so an operator can see that the picture is old.
 */
const TELEMETRY_STALE_AFTER_MS = 25 * 60 * 60 * 1000;

/** Ordered worst-last, so the overall state is simply the worst signal present. */
const SEVERITY: Record<HealthState, number> = { healthy: 0, unknown: 1, stale: 2, degraded: 3, unhealthy: 4 };

function worst(states: HealthState[]): HealthState {
  return states.reduce<HealthState>((acc, s) => (SEVERITY[s] > SEVERITY[acc] ? s : acc), "healthy");
}

/**
 * Builds every signal for one installation from recorded evidence.
 *
 * Note what is absent: no SSL health, no CPU, no disk capacity, no provider
 * status. Nothing reports those today, so inventing them would be fabricating
 * health — the one thing this module exists to prevent.
 */
export async function getInstallationHealth(installationId: number): Promise<InstallationHealth | null> {
  const [installation] = await db.select().from(installationsTable).where(eq(installationsTable.id, installationId));
  if (!installation) return null;

  const [policy, latestRun, telemetry, affectedOrganizations] = await Promise.all([
    getBackupPolicy(installationId),
    getLatestBackupRun(installationId),
    getTelemetry(installationId),
    listAffectedOrganizations(installationId),
  ]);

  const now = Date.now();
  const signals: HealthSignal[] = [];

  // --- Telemetry freshness ------------------------------------------------
  if (!telemetry) {
    signals.push({
      key: "telemetry",
      state: "unknown",
      detail: "Telemetry has not been received from this installation",
    });
  } else if (now - telemetry.observedAt.getTime() > TELEMETRY_STALE_AFTER_MS) {
    signals.push({
      key: "telemetry",
      state: "stale",
      detail: `Telemetry last received ${telemetry.observedAt.toISOString()}`,
    });
  } else {
    signals.push({ key: "telemetry", state: "healthy", detail: "Telemetry is current" });
  }

  // --- Application liveness and database readiness -------------------------
  // Reported values only. No report means unknown, never healthy.
  for (const [key, value, label] of [
    ["application", telemetry?.applicationHealthy, "Application"],
    ["database", telemetry?.databaseReady, "Database"],
  ] as const) {
    if (value == null) {
      signals.push({ key, state: "unknown", detail: `${label} status has not been reported` });
    } else if (value === 1) {
      signals.push({ key, state: "healthy", detail: `${label} reported healthy` });
    } else {
      signals.push({ key, state: "unhealthy", detail: `${label} reported unhealthy` });
    }
  }

  // --- Storage ------------------------------------------------------------
  // Aggregate only. Never a filename, a storage key or a document.
  if (!telemetry || telemetry.storageHealthy == null) {
    signals.push({ key: "storage", state: "unknown", detail: "Storage backend status has not been reported" });
  } else if (telemetry.storageHealthy === 1) {
    signals.push({
      key: "storage",
      state: "healthy",
      detail: `Storage backend (${telemetry.storageBackend ?? "unspecified"}) reported healthy`,
    });
  } else {
    signals.push({ key: "storage", state: "unhealthy", detail: "Storage backend reported unavailable" });
  }

  // --- Backup freshness ---------------------------------------------------
  if (!policy || policy.enabled !== 1) {
    signals.push({
      key: "backup_freshness",
      state: "unknown",
      detail: policy ? "Backup policy is disabled for this installation" : "No backup policy has been configured",
    });
  } else if (!latestRun) {
    signals.push({ key: "backup_freshness", state: "unknown", detail: "No backup evidence has been received" });
  } else if (latestRun.result === "failed") {
    signals.push({
      key: "backup_freshness",
      state: "unhealthy",
      detail: `Most recent backup failed${latestRun.failureCategory ? ` (${latestRun.failureCategory})` : ""}`,
    });
  } else if (policy.expectedFrequencyHours != null) {
    // Overdue is only meaningful against a configured cadence. Without one,
    // there is no expectation to breach and nothing can be "late".
    const reference = latestRun.recoveryPointAt ?? latestRun.completedAt ?? latestRun.evidenceReceivedAt;
    const overdue = now - reference.getTime() > policy.expectedFrequencyHours * 60 * 60 * 1000;
    signals.push({
      key: "backup_freshness",
      state: overdue ? "degraded" : "healthy",
      detail: overdue
        ? `Backup evidence overdue — last recovery point ${reference.toISOString()}`
        : `Last recovery point ${reference.toISOString()}`,
    });
  } else {
    signals.push({
      key: "backup_freshness",
      state: "healthy",
      detail: "Backup evidence received; no cadence expectation configured",
    });
  }

  // --- Backup coverage completeness ---------------------------------------
  // The storage durability work established that a database backup does not
  // protect authoritative binaries. A database-only success is therefore
  // reported as incomplete coverage, not as a healthy backup.
  if (!latestRun) {
    signals.push({ key: "backup_coverage", state: "unknown", detail: "No backup evidence to assess coverage" });
  } else if (latestRun.result === "succeeded") {
    signals.push({ key: "backup_coverage", state: "healthy", detail: "Database and binary storage both protected" });
  } else if (latestRun.result === "partial") {
    const missing: string[] = [];
    if (latestRun.databaseResult !== "succeeded") missing.push(`database ${latestRun.databaseResult}`);
    if (latestRun.binaryStorageResult !== "succeeded") missing.push(`binary storage ${latestRun.binaryStorageResult}`);
    signals.push({
      key: "backup_coverage",
      state: "degraded",
      detail: `Backup did not cover the full recovery surface (${missing.join(", ")})`,
    });
  } else {
    signals.push({ key: "backup_coverage", state: "unhealthy", detail: "Most recent backup failed" });
  }

  // --- Deployed version ---------------------------------------------------
  if (!installation.applicationVersion) {
    signals.push({ key: "deployment", state: "unknown", detail: "No deployment has been recorded" });
  } else if (telemetry?.reportedApplicationVersion && telemetry.reportedApplicationVersion !== installation.applicationVersion) {
    signals.push({
      key: "deployment",
      state: "degraded",
      detail: `Installation reports ${telemetry.reportedApplicationVersion}, registry records ${installation.applicationVersion}`,
    });
  } else {
    signals.push({ key: "deployment", state: "healthy", detail: `Running ${installation.applicationVersion}` });
  }

  return {
    installationId: installation.id,
    installationKey: installation.installationKey,
    name: installation.name,
    environmentType: installation.environmentType,
    hostingModel: installation.hostingModel,
    status: installation.status,
    currentApplicationVersion: installation.applicationVersion,
    currentGitCommit: installation.gitCommit,
    currentMigrationVersion: installation.migrationVersion,
    deployedAt: installation.deployedAt,
    overall: worst(signals.map((s) => s.state)),
    signals,
    affectedOrganizations,
  };
}

/** Fleet overview — every installation's health, computed the same way. */
export async function getFleetHealth(): Promise<InstallationHealth[]> {
  const installations = await db.select({ id: installationsTable.id }).from(installationsTable);
  const results: InstallationHealth[] = [];
  for (const row of installations) {
    const health = await getInstallationHealth(row.id);
    if (health) results.push(health);
  }
  return results;
}
