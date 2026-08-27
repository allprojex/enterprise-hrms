/**
 * WS-7 (§6/§16) — registers all nine shipped entity adapters into the
 * server-defined allow-list (adapterRegistry.ts). Called once at process
 * startup by both src/index.ts and src/worker.ts, exactly mirroring WS-6's
 * `registerShippedJobHandlers` (lib/jobHandlers.ts) pattern — the worker
 * process needs this registry populated too, since large/chunked migration
 * execution (§40) runs a WS-6 job handler there, and that handler resolves
 * `entityType` back through this same registry.
 *
 * Registration order here is cosmetic (dependency ORDER for execution is
 * derived at runtime from each adapter's own `dependsOn` via
 * `orderEntityTypesByDependency` — this file does not need to list them in
 * dependency order itself), but is written in dependency order anyway for
 * readability: structure, then employee, then every employee-dependent
 * entity.
 */
import { registerEntityAdapter } from "./adapterRegistry";
import { registerMigrationJobHandler } from "./jobHandler";
import { branchAdapter, departmentAdapter, positionAdapter } from "./entityAdapters/structure";
import { employeeAdapter } from "./entityAdapters/employee";
import { employmentHistoryAdapter } from "./entityAdapters/employmentHistory";
import { qualificationAdapter, certificationAdapter } from "./entityAdapters/qualificationsAndCertifications";
import { leaveBalanceAdapter } from "./entityAdapters/leaveBalance";

let adaptersRegistered = false;

/**
 * Idempotent — safe to call from both entrypoints, and from a test that
 * imports this module more than once in the same process, without tripping
 * the registry's own "already registered" guard.
 */
export function registerShippedEntityAdapters(): void {
  if (adaptersRegistered) return;
  adaptersRegistered = true;

  registerEntityAdapter(branchAdapter);
  registerEntityAdapter(departmentAdapter);
  registerEntityAdapter(positionAdapter);
  registerEntityAdapter(employeeAdapter);
  registerEntityAdapter(employmentHistoryAdapter);
  registerEntityAdapter(qualificationAdapter);
  registerEntityAdapter(certificationAdapter);
  registerEntityAdapter(leaveBalanceAdapter);

  // `payroll_opening_balance` is DELIBERATELY NOT REGISTERED — see
  // entityAdapters/payrollOpeningBalance.ts for the full analysis. In short:
  // this platform has no opening-balance concept, and the compensation
  // component the adapter reused is an effective-dated *rate*, not a
  // balance. Registering it would let an imported "opening balance" be paid
  // again every period and could silently supersede an employee's real
  // salary row. Blocked pending an Owner decision on the smallest correct
  // Payroll addition. Because every read/write path validates entityType
  // against this registry, leaving it unregistered blocks upload,
  // validation and execution for that type completely.

  // The WS-6 job type that executes a large migration in the worker
  // process. Registered here (rather than in lib/jobHandlers.ts alongside
  // the two platform-generic handlers) because it is WS-7's own domain
  // handler, not shipped background infrastructure — and because both
  // entrypoints already call this function, so it lands in both runtimes
  // without a second wiring point.
  registerMigrationJobHandler();
}
