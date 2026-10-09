/**
 * HR Dashboard Command Centre — service-level tests for resolveHrCommandCentre.
 *
 * Every owning-module service is mocked at its module boundary, so these tests
 * prove the COMPOSITION rules rather than re-testing each module:
 *
 *   - a section is computed only when its module is enabled AND the caller
 *     holds its permission; otherwise its service is never called and nothing
 *     (not even a zero) is returned;
 *   - tasks contain only work the caller can perform; monitor-only figures
 *     stay on attention cards;
 *   - tasks follow the Action Centre's deterministic overdue → due soon →
 *     undated order;
 *   - one failing section is named and does not take down the others;
 *   - every service call is scoped to the membership's organization;
 *   - recent activity reads the HR audit category only.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({
  permissions: new Set<string>(),
  enabledModules: new Set<string>(),
  organizationIdsSeen: new Set<number>(),
  auditRows: [] as Record<string, unknown>[],
  auditWhere: [] as unknown[],
  collectActionItems: vi.fn(),
  listSubmissionsAwaitingViewer: vi.fn(),
  listReviews: vi.fn(),
  listProbations: vi.fn(),
  runPersonnelReport: vi.fn(),
  resolveAssetReportScope: vi.fn(),
  getAssetDashboard: vi.fn(),
  resolveAttendanceReportScope: vi.fn(),
  getAttendanceDashboard: vi.fn(),
  listHolidayOccurrencesInRange: vi.fn(),
  resolveAllowedAuditCategories: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: () => {
      const chain: Record<string, unknown> = {};
      chain.from = () => chain;
      chain.leftJoin = () => chain;
      chain.where = (w: unknown) => {
        m.auditWhere.push(w);
        return chain;
      };
      chain.orderBy = () => chain;
      chain.limit = async () => m.auditRows;
      return chain;
    },
  },
  auditEventsTable: { id: "a.id", occurredAt: "a.occurredAt", eventType: "a.eventType", targetType: "a.targetType", actorApplicationUserId: "a.actor", organizationId: "a.organizationId", category: "a.category" },
  usersTable: { id: "u.id", firstName: "u.firstName", lastName: "u.lastName" },
}));
vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ and: conditions }),
  eq: (column: unknown, value: unknown) => ({ eq: [column, value] }),
  desc: (column: unknown) => ({ desc: column }),
  inArray: (column: unknown, values: unknown) => ({ inArray: [column, values] }),
}));
vi.mock("../lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock("../lib/permissions", () => ({
  getEffectivePermissions: async () => m.permissions,
  hasPermission: async (_membershipId: number, key: string) => m.permissions.has(key),
}));
vi.mock("../lib/organizationModules", () => ({
  getModuleAccess: async (organizationId: number, key: string) => {
    m.organizationIdsSeen.add(organizationId);
    return { enabled: m.enabledModules.has(key) };
  },
}));
vi.mock("../lib/actionCentre/providers", () => ({
  P1_PROVIDERS: [],
  ASSIGNABLE_PROVIDERS: [],
  nameMap: async (organizationId: number, ids: number[]) => {
    m.organizationIdsSeen.add(organizationId);
    return new Map(ids.map((id) => [id, { firstName: `First${id}`, lastName: `Last${id}` }]));
  },
  withName: (names: Map<number, { firstName: string; lastName: string }>, employeeId: number | null) =>
    employeeId == null
      ? { employeeId: null, employeeFirstName: null, employeeLastName: null }
      : { employeeId, employeeFirstName: names.get(employeeId)?.firstName ?? null, employeeLastName: names.get(employeeId)?.lastName ?? null },
}));
vi.mock("../lib/actionCentre/aggregate", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/actionCentre/aggregate")>()),
  collectActionItems: m.collectActionItems,
}));
vi.mock("../lib/formEngine/submissions", () => ({
  buildViewerContext: async (organizationId: number) => {
    m.organizationIdsSeen.add(organizationId);
    return {};
  },
  listSubmissionsAwaitingViewer: m.listSubmissionsAwaitingViewer,
}));
vi.mock("../lib/performanceCycles", () => ({ listReviews: m.listReviews }));
vi.mock("../lib/employmentLifecycle/probation", () => ({ listProbationsEndingOnOrBefore: m.listProbations }));
vi.mock("../lib/employmentLifecycle/config", () => ({
  resolveEmploymentLifecycleConfig: async () => ({ probationReminderDaysBefore: 14 }),
}));
vi.mock("../lib/personnelReporting", () => ({ runPersonnelReport: m.runPersonnelReport }));
vi.mock("../lib/assetReporting", () => ({
  resolveAssetReportScope: m.resolveAssetReportScope,
  getAssetDashboard: m.getAssetDashboard,
}));
vi.mock("../lib/attendanceReporting", () => ({
  resolveAttendanceReportScope: m.resolveAttendanceReportScope,
  buildAttendanceReportContext: async () => ({}),
  resolveOrganizationTodayCivilDate: async () => "2026-09-14",
  getAttendanceDashboard: m.getAttendanceDashboard,
}));
vi.mock("../lib/attendanceDailySummary", () => {
  class OrganizationTimezoneNotConfiguredError extends Error {}
  return { OrganizationTimezoneNotConfiguredError };
});
vi.mock("../lib/publicHolidays", () => ({ listHolidayOccurrencesInRange: m.listHolidayOccurrencesInRange }));
vi.mock("../lib/auditAuthorization", () => ({ resolveAllowedAuditCategories: m.resolveAllowedAuditCategories }));
vi.mock("../lib/leaveRequests", () => ({ toIsoDate: (d: Date) => d.toISOString().slice(0, 10) }));

import { resolveHrCommandCentre } from "../lib/hrCommandCentre";
import { OrganizationTimezoneNotConfiguredError } from "../lib/attendanceDailySummary";

const ORG = 10;
const CTX = { organizationId: ORG, applicationUserId: 7, membershipId: 70 };
const NOW = new Date("2026-09-14T09:00:00.000Z");

const HR_PERMISSIONS = [
  "leave_request.approve",
  "leave_request.manage",
  "form.read",
  "performance.manage",
  "performance.finalize",
  "employment_lifecycle.read",
  "employment_lifecycle.manage",
  "attendance.read.own",
  "attendance.manage",
  "personnel_file.read",
  "asset_management.reports.read",
  "public_holiday.read",
  "audit.read.hr",
];
const ALL_MODULES = ["leave", "performance", "attendance", "asset_management"];

function actionItem(overrides: Record<string, unknown>) {
  return {
    sourceModule: "leave",
    sourceType: "leave_request",
    sourceId: 1,
    actionKind: "approve",
    title: "Leave request",
    employeeId: 1,
    employeeFirstName: "A",
    employeeLastName: "B",
    status: "pending_hr",
    createdAt: new Date("2026-09-10T00:00:00Z"),
    dueAt: null,
    overdue: null,
    deepLink: "/leave-approvals",
    inlineCommands: ["leave.approve", "leave.reject"],
    ...overrides,
  };
}

function formSummary(overrides: Record<string, unknown> = {}) {
  return {
    id: 501,
    templateTitle: "Staff Leave Form",
    subjectEmployeeId: 44,
    status: "pending_approval",
    submittedAt: new Date("2026-09-08T00:00:00Z"),
    createdAt: new Date("2026-09-07T00:00:00Z"),
    stageName: "HR Review",
    ...overrides,
  };
}

beforeEach(() => {
  m.permissions = new Set();
  m.enabledModules = new Set();
  m.organizationIdsSeen = new Set();
  m.auditRows = [];
  m.auditWhere = [];
  m.collectActionItems.mockReset().mockResolvedValue({ items: [], answeredSources: [], unavailableSources: [] });
  m.listSubmissionsAwaitingViewer.mockReset().mockResolvedValue({ awaiting: [], awaitingOthers: null });
  m.listReviews.mockReset().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 100 });
  m.listProbations.mockReset().mockResolvedValue([]);
  m.runPersonnelReport.mockReset().mockResolvedValue({ rows: [] });
  m.resolveAssetReportScope.mockReset().mockResolvedValue({ isOrgWide: true, ownEmployeeId: null, directReportEmployeeIds: [] });
  m.getAssetDashboard.mockReset().mockResolvedValue({ overdueReturnCount: 0 });
  m.resolveAttendanceReportScope.mockReset().mockResolvedValue({ isOrgWide: true, allowedEmployeeIds: [] });
  m.getAttendanceDashboard.mockReset().mockResolvedValue({ date: "2026-09-14", totalEmployeesCount: 0, statusBreakdown: [] });
  m.listHolidayOccurrencesInRange.mockReset().mockResolvedValue([]);
  m.resolveAllowedAuditCategories.mockReset().mockResolvedValue([]);
});

describe("resolveHrCommandCentre — permission and module visibility", () => {
  it("gives an ordinary employee nothing to see: no tasks panel, no cards, no holidays, no activity — and computes none of them", async () => {
    const result = await resolveHrCommandCentre(CTX, NOW);

    expect(result.tasks).toBeNull();
    expect(result.attention).toEqual([]);
    expect(result.upcomingHolidays).toBeNull();
    expect(result.recentActivity).toBeNull();
    expect(result.unavailableSections).toEqual([]);
    // Unauthorized counts are never even computed.
    expect(m.listReviews).not.toHaveBeenCalled();
    expect(m.listProbations).not.toHaveBeenCalled();
    expect(m.runPersonnelReport).not.toHaveBeenCalled();
    expect(m.getAssetDashboard).not.toHaveBeenCalled();
    expect(m.getAttendanceDashboard).not.toHaveBeenCalled();
    expect(m.listHolidayOccurrencesInRange).not.toHaveBeenCalled();
  });

  it("shows every attention card with real counts to an HR holder of each source permission", async () => {
    m.permissions = new Set(HR_PERMISSIONS);
    m.enabledModules = new Set(ALL_MODULES);
    m.getAttendanceDashboard.mockResolvedValue({
      date: "2026-09-14",
      totalEmployeesCount: 20,
      statusBreakdown: [
        { status: "present", count: 12 },
        { status: "late", count: 2 },
        { status: "partial", count: 1 },
        { status: "absent", count: 3 },
        { status: "on_leave", count: 2 },
        { status: null, count: 0 },
      ],
    });
    m.listProbations.mockResolvedValue([{ id: 31, firstName: "P", lastName: "Q", probationEndDate: new Date("2026-09-20T00:00:00Z"), createdAt: new Date("2026-03-01T00:00:00Z") }]);
    m.listReviews.mockResolvedValue({ items: [], total: 4, page: 1, pageSize: 100 });
    m.runPersonnelReport.mockResolvedValue({ rows: [{ overdue: "Yes" }, { overdue: "No" }, { overdue: "Yes" }] });
    m.getAssetDashboard.mockResolvedValue({ overdueReturnCount: 5 });
    m.listSubmissionsAwaitingViewer.mockResolvedValue({ awaiting: [formSummary()], awaitingOthers: 3 });

    const result = await resolveHrCommandCentre(CTX, NOW);
    const byKey = Object.fromEntries(result.attention.map((c) => [c.key, c]));

    expect(byKey.attendance_exceptions).toMatchObject({ count: 6, deepLink: "/attendance-dashboard" });
    expect(byKey.probation_reviews_due).toMatchObject({ count: 1, deepLink: "/employees" });
    expect(byKey.performance_reviews_due).toMatchObject({ count: 4, deepLink: "/performance-reviews" });
    expect(byKey.personnel_files_attention).toMatchObject({ count: 2, deepLink: "/personnel-reports" });
    expect(byKey.assets_awaiting_return).toMatchObject({ count: 5, deepLink: "/assets-dashboard" });
    expect(byKey.forms_awaiting_review).toMatchObject({ count: 1, secondaryCount: 3, deepLink: "/forms" });
  });

  it("omits module-gated cards when the module is disabled, even with every permission, and never runs their queries", async () => {
    m.permissions = new Set(HR_PERMISSIONS);
    m.enabledModules = new Set(); // leave, performance, attendance, assets all disabled

    const result = await resolveHrCommandCentre(CTX, NOW);
    const keys = result.attention.map((c) => c.key);

    expect(keys).not.toContain("performance_reviews_due");
    expect(keys).not.toContain("assets_awaiting_return");
    expect(keys).not.toContain("attendance_exceptions");
    expect(result.upcomingHolidays).toBeNull();
    expect(m.listReviews).not.toHaveBeenCalled();
    expect(m.getAssetDashboard).not.toHaveBeenCalled();
    expect(m.getAttendanceDashboard).not.toHaveBeenCalled();
    expect(m.listHolidayOccurrencesInRange).not.toHaveBeenCalled();
  });

  it("omits a card whose permission is missing even when its module is enabled", async () => {
    m.permissions = new Set(["form.read"]);
    m.enabledModules = new Set(ALL_MODULES);

    const result = await resolveHrCommandCentre(CTX, NOW);

    expect(result.attention.map((c) => c.key)).toEqual(["forms_awaiting_review"]);
    expect(m.getAssetDashboard).not.toHaveBeenCalled();
    expect(m.listReviews).not.toHaveBeenCalled();
  });

  it("hides attendance exceptions for a team-scoped (non org-wide) viewer and when no timezone is configured", async () => {
    m.permissions = new Set(["attendance.read.own"]);
    m.enabledModules = new Set(["attendance"]);
    m.resolveAttendanceReportScope.mockResolvedValue({ isOrgWide: false, allowedEmployeeIds: [1, 2] });
    expect((await resolveHrCommandCentre(CTX, NOW)).attention).toEqual([]);

    m.resolveAttendanceReportScope.mockResolvedValue({ isOrgWide: true, allowedEmployeeIds: [] });
    m.getAttendanceDashboard.mockRejectedValue(new OrganizationTimezoneNotConfiguredError());
    const result = await resolveHrCommandCentre(CTX, NOW);
    expect(result.attention).toEqual([]);
    expect(result.unavailableSections).toEqual([]);
  });
});

describe("resolveHrCommandCentre — My HR Tasks", () => {
  it("merges Action Centre work with form, performance and probation tasks in the deterministic overdue → due soon → undated order", async () => {
    m.permissions = new Set(HR_PERMISSIONS);
    m.enabledModules = new Set(ALL_MODULES);
    m.collectActionItems.mockResolvedValue({
      items: [
        actionItem({ sourceModule: "leave", sourceId: 1, createdAt: new Date("2026-09-10T00:00:00Z") }),
        actionItem({ sourceModule: "learning", sourceType: "learning_enrollment", sourceId: 2, dueAt: new Date("2026-09-20T00:00:00Z"), overdue: false }),
        actionItem({ sourceModule: "onboarding", sourceType: "onboarding_task", sourceId: 3, dueAt: new Date("2026-09-01T00:00:00Z"), overdue: true }),
      ],
      answeredSources: ["leave", "learning", "onboarding"],
      unavailableSources: [],
    });
    m.listSubmissionsAwaitingViewer.mockResolvedValue({ awaiting: [formSummary()], awaitingOthers: 0 });
    m.listReviews.mockResolvedValue({
      items: [{ id: 900, employeeId: 12, status: "hr_review", createdAt: new Date("2026-09-12T00:00:00Z") }],
      total: 1,
      page: 1,
      pageSize: 100,
    });
    m.listProbations.mockResolvedValue([{ id: 31, firstName: "P", lastName: "Q", probationEndDate: new Date("2026-09-20T00:00:00Z"), createdAt: new Date("2026-03-01T00:00:00Z") }]);

    const result = await resolveHrCommandCentre(CTX, NOW);
    const tasks = result.tasks!;

    expect(tasks.total).toBe(6);
    expect(tasks.overdue).toBe(1);
    expect(tasks.items.map((t) => `${t.sourceModule}:${t.sourceId}`)).toEqual([
      "onboarding:3", // overdue first
      "learning:2", // then due soon
      "employment_lifecycle:31", // then undated, oldest first
      "forms:501",
      "leave:1",
      "performance:900",
    ]);
    const form = tasks.items.find((t) => t.sourceModule === "forms")!;
    expect(form).toMatchObject({ title: "Staff Leave Form", context: "Stage: HR Review", deepLink: "/forms/501", employeeFirstName: "First44", dueAt: null, overdue: null });
    const probation = tasks.items.find((t) => t.sourceModule === "employment_lifecycle")!;
    expect(probation).toMatchObject({ context: "Probation ends 2026-09-20", dueAt: null, deepLink: "/employees/31" });
    // The dashboard is read-only: no inline command identifiers leak through.
    expect(tasks.items.every((t) => !("inlineCommands" in t))).toBe(true);
  });

  it("keeps monitor-only work out of tasks: forms at other stages and performance oversight without finalize authority", async () => {
    m.permissions = new Set(["form.read", "performance.manage", "employment_lifecycle.read"]);
    m.enabledModules = new Set(ALL_MODULES);
    m.listSubmissionsAwaitingViewer.mockResolvedValue({ awaiting: [], awaitingOthers: 4 });
    m.listReviews.mockResolvedValue({ items: [{ id: 900, employeeId: 12, status: "hr_review", createdAt: NOW }], total: 1, page: 1, pageSize: 100 });
    m.listProbations.mockResolvedValue([{ id: 31, firstName: "P", lastName: "Q", probationEndDate: NOW, createdAt: NOW }]);

    const result = await resolveHrCommandCentre(CTX, NOW);

    // The panel exists (form.read is an HR oversight source) but holds nothing to do.
    expect(result.tasks).toMatchObject({ items: [], total: 0, overdue: 0 });
    const forms = result.attention.find((c) => c.key === "forms_awaiting_review")!;
    expect(forms).toMatchObject({ count: 0, secondaryCount: 4 });
    expect(result.attention.find((c) => c.key === "performance_reviews_due")!.count).toBe(1);
    expect(result.attention.find((c) => c.key === "probation_reviews_due")!.count).toBe(1);
  });

  it("gives a non-HR stage actor (e.g. a Department Head) their form tasks without an HR oversight card", async () => {
    m.permissions = new Set(["employee.read"]);
    m.listSubmissionsAwaitingViewer.mockResolvedValue({ awaiting: [formSummary({ stageName: "Head of Department" })], awaitingOthers: null });

    const result = await resolveHrCommandCentre(CTX, NOW);

    expect(result.tasks!.items.map((t) => t.sourceModule)).toEqual(["forms"]);
    expect(result.attention).toEqual([]);
  });

  it("isolates a failing section: it is named, and every other section still answers", async () => {
    m.permissions = new Set(HR_PERMISSIONS);
    m.enabledModules = new Set(ALL_MODULES);
    m.listReviews.mockRejectedValue(new Error("db down"));
    m.getAssetDashboard.mockResolvedValue({ overdueReturnCount: 2 });

    const result = await resolveHrCommandCentre(CTX, NOW);

    expect(result.unavailableSections).toEqual(["performance"]);
    expect(result.attention.map((c) => c.key)).not.toContain("performance_reviews_due");
    expect(result.attention.find((c) => c.key === "assets_awaiting_return")!.count).toBe(2);
    expect(result.tasks!.unavailableSources).toContain("performance");
  });

  it("collapses a thrown authorization check to hidden rather than failed — no module existence signal", async () => {
    m.permissions = new Set(["asset_management.reports.read"]);
    m.enabledModules = new Set(["asset_management"]);
    m.resolveAllowedAuditCategories.mockRejectedValue(new Error("permission lookup failed"));

    const result = await resolveHrCommandCentre(CTX, NOW);

    expect(result.recentActivity).toBeNull();
    expect(result.unavailableSections).not.toContain("activity");
  });
});

describe("resolveHrCommandCentre — tenant isolation, holidays and activity", () => {
  it("scopes every source call to the membership's organization and never any other", async () => {
    m.permissions = new Set(HR_PERMISSIONS);
    m.enabledModules = new Set(ALL_MODULES);
    m.listSubmissionsAwaitingViewer.mockResolvedValue({ awaiting: [formSummary()], awaitingOthers: 0 });

    await resolveHrCommandCentre(CTX, NOW);

    expect(m.collectActionItems).toHaveBeenCalledWith(expect.objectContaining({ organizationId: ORG, membershipId: 70 }), "my_actions");
    expect(m.listSubmissionsAwaitingViewer.mock.calls[0]![0]).toBe(ORG);
    expect(m.listReviews.mock.calls[0]![0]).toMatchObject({ organizationId: ORG, status: "hr_review" });
    expect(m.listProbations.mock.calls[0]![0]).toBe(ORG);
    expect(m.runPersonnelReport.mock.calls[0]![0]).toMatchObject({ organizationId: ORG, key: "personnel_checked_out_overdue_files" });
    expect(m.getAssetDashboard.mock.calls[0]![0]).toBe(ORG);
    expect(m.listHolidayOccurrencesInRange.mock.calls[0]![0]).toBe(ORG);
    expect([...m.organizationIdsSeen]).toEqual([ORG]);
  });

  it("lists up to five upcoming holidays in date order within 60 days", async () => {
    m.permissions = new Set(["public_holiday.read"]);
    m.enabledModules = new Set(["leave"]);
    m.listHolidayOccurrencesInRange.mockResolvedValue([
      { id: 3, name: "C", date: "2026-10-30" },
      { id: 1, name: "A", date: "2026-09-21" },
      { id: 2, name: "B", date: "2026-10-01" },
      { id: 4, name: "D", date: "2026-11-01" },
      { id: 5, name: "E", date: "2026-11-05" },
      { id: 6, name: "F", date: "2026-11-10" },
    ]);

    const result = await resolveHrCommandCentre(CTX, NOW);

    expect(m.listHolidayOccurrencesInRange).toHaveBeenCalledWith(ORG, "2026-09-14", "2026-11-13");
    expect(result.upcomingHolidays!.map((h) => h.id)).toEqual([1, 2, 3, 4, 5]);
  });

  it("returns recent activity only to an HR-audit reader, restricted to the hr category and redacted", async () => {
    m.resolveAllowedAuditCategories.mockResolvedValue(["security", "payroll"]);
    expect((await resolveHrCommandCentre(CTX, NOW)).recentActivity).toBeNull();
    expect(m.auditWhere).toHaveLength(0);

    m.resolveAllowedAuditCategories.mockResolvedValue("all");
    m.auditRows = [
      { id: 1, occurredAt: NOW, eventType: "employee.updated", targetType: "employee", actorFirstName: "Ada", actorLastName: "Lovelace" },
      { id: 2, occurredAt: NOW, eventType: "leave_request.approved", targetType: "leave_request", actorFirstName: null, actorLastName: null },
    ];
    const result = await resolveHrCommandCentre(CTX, NOW);

    expect(result.recentActivity).toEqual([
      { id: 1, occurredAt: NOW, eventType: "employee.updated", targetType: "employee", actorName: "Ada Lovelace" },
      { id: 2, occurredAt: NOW, eventType: "leave_request.approved", targetType: "leave_request", actorName: null },
    ]);
    expect(JSON.stringify(m.auditWhere)).toContain('"inArray":["a.category",["hr"]]');
    expect(JSON.stringify(m.auditWhere)).toContain(`"eq":["a.organizationId",${ORG}]`);
  });
});
