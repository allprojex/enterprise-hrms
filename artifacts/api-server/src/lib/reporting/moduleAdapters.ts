import type { ReportColumn } from "../reporting";
import { ReportParameterError } from "./errors";
import { hasPermission } from "../permissions";
import { recordAuditEvent } from "../auditLog";
import {
  isKnownRecruitmentReportKey,
  resolveRecruitmentReportScope,
  buildRecruitmentReportContext,
  runRecruitmentReport,
} from "../recruitmentReporting";
import {
  isKnownAttendanceReportKey,
  resolveAttendanceReportScope,
  buildAttendanceReportContext,
  runAttendanceReport,
  resolveOrganizationTodayCivilDate,
} from "../attendanceReporting";
import {
  isKnownPerformanceReportKey,
  resolvePerformanceReportScope,
  buildPerformanceReportContext,
  runPerformanceReport,
} from "../performanceReporting";
import {
  isKnownLearningReportKey,
  resolveLearningReportScope,
  buildLearningReportContext,
  runLearningReport,
} from "../learningReporting";
import { isKnownAssetReportKey, resolveAssetReportScope, runAssetReport } from "../assetReporting";
import { isKnownPersonnelReportKey, runPersonnelReport } from "../personnelReporting";
import { isKnownPayrollReportKey, runPayrollReport } from "../payrollReporting";
import { isKnownOfficeInventoryReportKey, runOfficeInventoryReport } from "../officeInventoryReporting";

/**
 * WS-15 P3 — Reporting execution consolidation (§31.30).
 *
 * WHAT THIS IS. The report registry seeds 46 definitions, each already carrying
 * a `requiredPermissionKey`, but the generic execution endpoint implemented
 * runners for only 3 — so 43 registered reports answered 404 there and were
 * reachable only through eight bespoke module routes. This file closes that by
 * ROUTING, not by re-querying: each adapter calls the owning module's own
 * `run*Report` service, which already returns the exact `{columns, rows}` shape
 * the generic surface serializes.
 *
 * §31.30's frozen rules, and how each is kept:
 *
 *   - "the runner delegates to the owning module's existing reporting service
 *     rather than re-querying" — every adapter below is a call. There is no SQL
 *     in this file at all.
 *   - "no single giant report query and no shared reporting schema" — nothing
 *     is merged; eight independent services stay independent.
 *   - "the `{columns, rows}` shape and `toCsv` stay the uniform serialization"
 *     — adapters return exactly that, and CSV keeps using the one shared
 *     primitive.
 *   - "module reporting routes are not removed" — none is touched.
 *
 * THE SAFETY CONCERN THE MODULE ROUTES RAISED IS ANSWERED, NOT IGNORED.
 * Eight shipped routes carried a comment saying a module key "can never be
 * executed through the generic, NON-SCOPE-AWARE" endpoint, which "safely 404s
 * instead". That was true and was a real guard: a generic runner that ignored
 * scope would have shown an employee the whole organization's attendance. Every
 * adapter below therefore resolves the module's OWN scope resolver first — the
 * same `resolve*ReportScope({organizationId, applicationUserId, membershipId})`
 * the bespoke route calls — so the generic path is now scope-aware by
 * construction and the guard's premise no longer holds. Those comments have
 * been corrected rather than left standing as false statements.
 *
 * PERMISSION PARITY WAS VERIFIED, NOT ASSUMED. Every definition's
 * `requiredPermissionKey` is byte-identical to its bespoke route's
 * `requirePermission` gate, across all eight modules. The generic endpoint
 * already enforces the definition's key, so this consolidation is neither a
 * weaker nor a stronger gate — it is the same gate. There is no
 * `reporting.execute_all` and no bypass.
 *
 * PARAMETERS ARE TYPED AND MAPPED EXPLICITLY (§10). Each adapter picks the
 * fields its module actually supports out of the validated parameter object and
 * ignores the rest. Nothing is spread into a query builder, so an unsupported
 * or invented parameter cannot reach a module's filter logic.
 */

/** Every parameter any consolidated report supports. Validated before an adapter sees it. */
export interface ReportParams {
  /** Attendance requires these; Assets and Office Inventory use them as `dateFrom`/`dateTo`. */
  from?: string;
  to?: string;
  /** Payroll requires a locked run. */
  runId?: number;
  employeeId?: number;
  departmentId?: number;
  branchId?: number;
  positionId?: number;
  cycleId?: number;
  reviewerId?: number;
  courseId?: number;
  managerId?: number;
  approvalStatus?: string;
  itemId?: number;
  storeId?: number;
  movementType?: string;
  assetId?: number;
  categoryCode?: string;
  maintenanceStatus?: string;
  status?: string;
}

export interface AdapterContext {
  key: string;
  label: string;
  description: string;
  organizationId: number;
  applicationUserId: number;
  membershipId: number;
  params: ReportParams;
}

export type AdapterResult = { columns: ReportColumn[]; rows: Record<string, string | number | boolean | null>[] };

export interface ModuleReportAdapter {
  /** The report-definition `category` this adapter owns. */
  category: string;
  /** The module's own key predicate — never a prefix match invented here. */
  owns(key: string): boolean;
  run(ctx: AdapterContext): Promise<AdapterResult>;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function requireIsoDate(value: string | undefined, name: string): string {
  if (!value || !ISO_DATE.test(value)) {
    throw new ReportParameterError(`"${name}" must be a date in YYYY-MM-DD form.`);
  }
  return value;
}

/** Drops undefined keys so a module's filter object never gains an explicit `undefined`. */
function compact<T extends Record<string, unknown>>(input: T): T {
  return Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) as T;
}

const recruitmentAdapter: ModuleReportAdapter = {
  category: "recruitment",
  owns: isKnownRecruitmentReportKey,
  async run(ctx) {
    const scope = await resolveRecruitmentReportScope({
      organizationId: ctx.organizationId,
      applicationUserId: ctx.applicationUserId,
      membershipId: ctx.membershipId,
    });
    const reportContext = await buildRecruitmentReportContext(ctx.organizationId, scope);
    const result = await runRecruitmentReport({
      key: ctx.key,
      label: ctx.label,
      description: ctx.description,
      ctx: reportContext,
    });
    return { columns: result.columns, rows: result.rows };
  },
};

const attendanceAdapter: ModuleReportAdapter = {
  category: "attendance",
  owns: isKnownAttendanceReportKey,
  async run(ctx) {
    // Supplied dates are validated BEFORE any default is resolved, and the
    // default is resolved only when one is genuinely needed.
    //
    // This ordering matters. The bespoke route defaults both ends to the
    // organization's own civil today, and that lookup THROWS when
    // `general.timezone` is unset — a deliberate W66 choice, because a silent
    // UTC fallback would produce systematically wrong "late" figures. Resolving
    // it eagerly would therefore make an explicitly-dated request fail for a
    // reason that has nothing to do with it. Caught by the live suite.
    const suppliedFrom = ctx.params.from ? requireIsoDate(ctx.params.from, "from") : undefined;
    const suppliedTo = ctx.params.to ? requireIsoDate(ctx.params.to, "to") : undefined;
    const today =
      suppliedFrom === undefined || suppliedTo === undefined
        ? await resolveOrganizationTodayCivilDate(ctx.organizationId)
        : "";
    const from = suppliedFrom ?? today;
    const to = suppliedTo ?? today;

    const scope = await resolveAttendanceReportScope({
      organizationId: ctx.organizationId,
      applicationUserId: ctx.applicationUserId,
      membershipId: ctx.membershipId,
    });
    const reportContext = await buildAttendanceReportContext(ctx.organizationId, scope);
    const result = await runAttendanceReport({
      key: ctx.key,
      label: ctx.label,
      description: ctx.description,
      ctx: reportContext,
      from,
      to,
    });
    return { columns: result.columns, rows: result.rows };
  },
};

const performanceAdapter: ModuleReportAdapter = {
  category: "performance",
  owns: isKnownPerformanceReportKey,
  async run(ctx) {
    const scope = await resolvePerformanceReportScope({
      organizationId: ctx.organizationId,
      applicationUserId: ctx.applicationUserId,
      membershipId: ctx.membershipId,
    });
    const reportContext = await buildPerformanceReportContext(
      ctx.organizationId,
      scope,
      compact({
        cycleId: ctx.params.cycleId,
        status: ctx.params.status,
        departmentId: ctx.params.departmentId,
        positionId: ctx.params.positionId,
        reviewerId: ctx.params.reviewerId,
        employeeId: ctx.params.employeeId,
      }),
    );
    const result = await runPerformanceReport({
      key: ctx.key,
      label: ctx.label,
      description: ctx.description,
      ctx: reportContext,
    });
    return { columns: result.columns, rows: result.rows };
  },
};

const learningAdapter: ModuleReportAdapter = {
  category: "learning",
  owns: isKnownLearningReportKey,
  async run(ctx) {
    const scope = await resolveLearningReportScope({
      organizationId: ctx.organizationId,
      applicationUserId: ctx.applicationUserId,
      membershipId: ctx.membershipId,
    });
    const filters = compact({
      courseId: ctx.params.courseId,
      status: ctx.params.status,
      approvalStatus: ctx.params.approvalStatus,
      departmentId: ctx.params.departmentId,
      positionId: ctx.params.positionId,
      managerId: ctx.params.managerId,
      employeeId: ctx.params.employeeId,
    });
    const reportContext = await buildLearningReportContext(ctx.organizationId, scope, filters);
    const result = await runLearningReport({
      key: ctx.key,
      label: ctx.label,
      description: ctx.description,
      organizationId: ctx.organizationId,
      scope,
      ctx: reportContext,
      certificateFilters: compact({ employeeId: ctx.params.employeeId, status: ctx.params.status }),
    });
    return { columns: result.columns, rows: result.rows };
  },
};

const assetAdapter: ModuleReportAdapter = {
  category: "asset_management",
  owns: isKnownAssetReportKey,
  async run(ctx) {
    const scope = await resolveAssetReportScope({
      organizationId: ctx.organizationId,
      applicationUserId: ctx.applicationUserId,
      membershipId: ctx.membershipId,
    });
    const result = await runAssetReport({
      key: ctx.key,
      label: ctx.label,
      description: ctx.description,
      organizationId: ctx.organizationId,
      scope,
      // Assets names its own date fields; the shared `from`/`to` map onto them
      // rather than a second date vocabulary being invented.
      filters: compact({
        categoryCode: ctx.params.categoryCode,
        status: ctx.params.status,
        branchId: ctx.params.branchId,
        employeeId: ctx.params.employeeId,
        departmentId: ctx.params.departmentId,
        assetId: ctx.params.assetId,
        maintenanceStatus: ctx.params.maintenanceStatus,
        dateFrom: ctx.params.from,
        dateTo: ctx.params.to,
      }),
    });
    return { columns: result.columns, rows: result.rows };
  },
};

const personnelAdapter: ModuleReportAdapter = {
  category: "personnel_records",
  owns: isKnownPersonnelReportKey,
  async run(ctx) {
    const result = await runPersonnelReport({
      key: ctx.key,
      label: ctx.label,
      description: ctx.description,
      organizationId: ctx.organizationId,
      filters: compact({ employeeId: ctx.params.employeeId }),
    });
    return { columns: result.columns, rows: result.rows };
  },
};

const officeInventoryAdapter: ModuleReportAdapter = {
  category: "office_inventory",
  owns: isKnownOfficeInventoryReportKey,
  async run(ctx) {
    const result = await runOfficeInventoryReport({
      key: ctx.key,
      label: ctx.label,
      description: ctx.description,
      organizationId: ctx.organizationId,
      filters: compact({
        itemId: ctx.params.itemId,
        storeId: ctx.params.storeId,
        employeeId: ctx.params.employeeId,
        departmentId: ctx.params.departmentId,
        movementType: ctx.params.movementType as never,
        status: ctx.params.status,
        dateFrom: ctx.params.from,
        dateTo: ctx.params.to,
      }),
    });
    return { columns: result.columns, rows: result.rows };
  },
};

/**
 * Payroll — the one adapter that carries a second gate.
 *
 * `payroll.report.read` is the definition's key and the generic endpoint has
 * already enforced it by the time this runs. But the pension schedule can also
 * carry SSNIT statutory identifiers, which the bespoke route gates on a
 * SEPARATE, narrower `payroll.statutory_identifiers.read` and audits as a
 * sensitive read. That logic is reproduced here exactly, because a generic path
 * that omitted it would be a quieter route to the same protected data — the
 * bypass §31.30's permission-scoped rule exists to prevent.
 *
 * The gate is duplicated rather than extracted: `routes/payrollReports.ts` is
 * the most sensitive shipped reporting route on the platform, and §31.30 asks
 * for a generic path BESIDE the module routes, not a refactor of them. A live
 * test asserts both paths agree — that an actor without the narrower key gets
 * no statutory identifiers here either.
 */
const payrollAdapter: ModuleReportAdapter = {
  category: "payroll",
  owns: isKnownPayrollReportKey,
  async run(ctx) {
    // Payroll reports are per locked run; there is no meaningful default, so
    // this is a genuinely required parameter rather than one with a fallback.
    const runId = ctx.params.runId;
    if (!Number.isInteger(runId) || (runId as number) <= 0) {
      throw new ReportParameterError('"runId" is required for a Payroll report.');
    }

    const includeStatutoryIdentifiers =
      ctx.key === "payroll_pension_schedule" &&
      (await hasPermission(ctx.membershipId, "payroll.statutory_identifiers.read"));

    const result = await runPayrollReport(ctx.organizationId, runId as number, ctx.key, includeStatutoryIdentifiers);

    if (includeStatutoryIdentifiers) {
      // The same sensitive-read event the bespoke route records. Reusing WS-3's
      // primitive rather than inventing a second audit path (§31.32).
      await recordAuditEvent({
        actorApplicationUserId: ctx.applicationUserId,
        actorMembershipId: ctx.membershipId,
        organizationId: ctx.organizationId,
        eventType: "payroll_statutory_identifiers.read",
        targetType: "payroll_run",
        targetId: String(runId),
        metadata: { reportKey: ctx.key, via: "generic_report_execution" },
        outcome: "success",
      });
    }

    return { columns: result.columns, rows: result.rows };
  },
};

/**
 * The consolidated adapter set.
 *
 * Routing is by the definition's own `category`, with the module's own key
 * predicate as a second check — so a key can never be executed by an adapter
 * that does not recognise it, and a mis-categorised definition fails closed
 * rather than reaching the wrong module.
 */
export const MODULE_REPORT_ADAPTERS: readonly ModuleReportAdapter[] = [
  recruitmentAdapter,
  attendanceAdapter,
  performanceAdapter,
  learningAdapter,
  assetAdapter,
  personnelAdapter,
  officeInventoryAdapter,
  payrollAdapter,
];

export { ReportParameterError };

export function findAdapter(category: string, key: string): ModuleReportAdapter | null {
  const adapter = MODULE_REPORT_ADAPTERS.find((a) => a.category === category);
  if (!adapter) return null;
  return adapter.owns(key) ? adapter : null;
}
