/**
 * WS-17 Slice 1 — the platform operations control plane.
 *
 * Records policy, requests and evidence for installations; derives Fleet
 * Health from what has actually been reported. Infrastructure executes; this
 * plane governs and observes. There is no command execution, no shell, no
 * provider credential and no restore anywhere in this module — restore is a
 * separately gated pass.
 */
export {
  PLATFORM_OPERATION_PERMISSIONS,
  RESERVED_RESTORE_PERMISSIONS,
  GRANTABLE_PLATFORM_PERMISSIONS,
  PlatformAuthorityError,
  hasPlatformPermission,
  hasPlatformAuthority,
  assertPlatformAuthority,
  listLivePlatformPermissions,
  type PlatformOperationPermission,
} from "./authority";

export {
  InstallationNotFoundError,
  InvalidOperationalStateError,
  listAffectedOrganizations,
  recordDeployment,
  listDeployments,
  upsertBackupPolicy,
  getBackupPolicy,
  requestBackup,
  updateBackupRequestStatus,
  listBackupRequests,
  deriveBackupRunResult,
  recordBackupRun,
  listBackupRuns,
  getLatestBackupRun,
  recordTelemetry,
  getTelemetry,
  type OperationActor,
  type RecordDeploymentParams,
  type UpsertBackupPolicyParams,
  type RecordBackupRunParams,
  type RecordTelemetryParams,
} from "./operations";

export {
  getInstallationHealth,
  getFleetHealth,
  type HealthState,
  type HealthSignal,
  type InstallationHealth,
} from "./fleetHealth";
