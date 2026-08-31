/**
 * WS-17 File Storage Durability, Pass 2 — storage reconciliation and binary
 * migration.
 *
 * NOT the Enterprise Migration Centre. That is a future BUSINESS capability
 * for onboarding a client's HR data from spreadsheets, legacy systems and
 * scanned records. This is platform-operations tooling that moves the HRMS's
 * own binary storage between backends and reports on its integrity. The names
 * here say "storage" and "binary" throughout, deliberately, so the two never
 * get confused.
 *
 * Platform operations, not tenant functionality: every entry point takes an
 * explicit organization scope and an operator actor, and none of it is exposed
 * to ordinary organization users.
 */
export {
  STORAGE_REFERENCE_SOURCES,
  listStorageReferences,
  type StorageReference,
  type StorageReferenceSource,
  type ReferenceScope,
  type ReferenceCriticality,
} from "./references";

export {
  reconcileStorage,
  findOrphanBinaries,
  type ReconciliationReport,
  type ReconciliationItem,
  type ReconciliationStatus,
  type ReconcileOptions,
} from "./reconcile";

export {
  registerHistoricalObjects,
  migrateObjects,
  type RegistrationResult,
  type MigrationResult,
  type MigrationOutcome,
  type OperationActor,
} from "./migrate";
