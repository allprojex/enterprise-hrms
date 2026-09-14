/**
 * Form engine — "awaiting this viewer" versus "visible to this viewer".
 *
 * listSubmissionsAwaitingViewer feeds the dashboard's Forms Awaiting HR Review
 * card and My HR Tasks, so it must count only work the viewer can act on now:
 *
 *   - only pending_approval submissions (a draft — including an HR-assisted,
 *     on-behalf draft — is never an approval task);
 *   - only where the CURRENT stage resolves to the viewer (a form still with a
 *     Department Head is not HR's, even for a form.read holder);
 *   - maker-checker: a subject or creator keeps only `complete`;
 *   - the "elsewhere in workflow" figure only for a form.read holder.
 *
 * listVisibleSubmissions keeps its behaviour after sharing the stage helper.
 * templates.ts (the live stage resolver) and @workspace/db are mocked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  whereArgs: [] as unknown[],
  stagesByVersion: new Map<number, Record<string, unknown>[]>(),
  listStagesCalls: [] as number[],
  /** membershipId → set of "versionId:stageOrder" the membership resolves to. */
  resolves: new Map<number, Set<string>>(),
}));

vi.mock("@workspace/db", () => {
  const chain: Record<string, unknown> = {};
  chain.from = () => chain;
  chain.innerJoin = () => chain;
  chain.leftJoin = () => chain;
  chain.where = (w: unknown) => {
    m.whereArgs.push(w);
    return chain;
  };
  chain.orderBy = async () => m.rows;
  const table = (name: string) => new Proxy({}, { get: (_t, col) => `${name}.${String(col)}` });
  return {
    db: { select: () => chain },
    formSubmissionsTable: table("form_submissions"),
    formTemplatesTable: table("form_templates"),
    formTemplateVersionsTable: table("form_template_versions"),
    formWorkflowStagesTable: table("form_workflow_stages"),
    formSignaturesTable: table("form_signatures"),
    employeesTable: table("employees"),
    employeeUserLinksTable: table("employee_user_links"),
    organizationMembershipsTable: table("organization_memberships"),
  };
});
vi.mock("drizzle-orm", () => ({
  and: (...c: unknown[]) => ({ and: c }),
  eq: (a: unknown, b: unknown) => ({ eq: [a, b] }),
  asc: (a: unknown) => ({ asc: a }),
  desc: (a: unknown) => ({ desc: a }),
  inArray: (a: unknown, b: unknown) => ({ inArray: [a, b] }),
  isNull: (a: unknown) => ({ isNull: a }),
  sql: () => ({}),
}));
vi.mock("../lib/auditLog", () => ({ recordAuditEvent: vi.fn() }));
vi.mock("../lib/fileStorage", () => ({ writeOrgFile: vi.fn(), discardOrphanedFile: vi.fn() }));
vi.mock("../lib/permissions", () => ({ getEffectivePermissions: vi.fn() }));
vi.mock("../lib/formEngine/render", () => ({ renderSubmissionDocument: vi.fn() }));
vi.mock("../lib/formEngine/answers", () => ({ validateAnswers: vi.fn(), computeValues: vi.fn(), sectionKeysEditableBy: vi.fn() }));
vi.mock("../lib/formEngine/bindings", () => ({ resolveAutofill: vi.fn(), readonlyKeys: vi.fn() }));
vi.mock("../lib/formEngine/sensitivity", () => ({ redactedSensitiveKeys: vi.fn(), redactValues: vi.fn() }));
vi.mock("../lib/formEngine/templates", () => ({
  getTemplate: vi.fn(),
  getPublishedVersion: vi.fn(),
  getVersion: vi.fn(),
  parseDefinition: vi.fn(),
  listStages: async (_organizationId: number, versionId: number) => {
    m.listStagesCalls.push(versionId);
    return m.stagesByVersion.get(versionId) ?? [];
  },
  membershipSatisfiesFormStage: async (p: { stage: { templateVersionId: number; stageOrder: number }; membershipId: number }) =>
    m.resolves.get(p.membershipId)?.has(`${p.stage.templateVersionId}:${p.stage.stageOrder}`) ?? false,
}));

import { listSubmissionsAwaitingViewer, listVisibleSubmissions } from "../lib/formEngine/submissions";

const ORG = 10;
const HR_MEMBERSHIP = 70;
const HOD_MEMBERSHIP = 80;
const EMPLOYEE_MEMBERSHIP = 90;

function stage(versionId: number, stageOrder: number, name: string, allowedActions: string[]) {
  return { templateVersionId: versionId, stageOrder, name, allowedActions, resolver: "permission_holder", resolverConfig: {} };
}

function row(id: number, overrides: Record<string, unknown> = {}) {
  return {
    submission: {
      id,
      organizationId: ORG,
      templateId: 1,
      templateVersionId: 100,
      subjectEmployeeId: 500,
      status: "pending_approval",
      currentStageOrder: 1,
      stageCountSnapshot: 2,
      createdByMembershipId: EMPLOYEE_MEMBERSHIP,
      submittedAt: new Date("2026-09-10T00:00:00Z"),
      createdAt: new Date("2026-09-09T00:00:00Z"),
      ...overrides,
    },
    templateTitle: "Staff Leave Form",
    templateKey: "staff_leave",
    formType: "request",
    versionNumber: 1,
    subjectFirstName: "Kofi",
    subjectLastName: "Mensah",
  };
}

const viewer = (membershipId: number, permissions: string[] = [], employeeId: number | null = null) => ({
  userId: membershipId + 1000,
  membershipId,
  employeeId,
  permissions: new Set(permissions),
});

beforeEach(() => {
  m.rows = [];
  m.whereArgs = [];
  m.listStagesCalls = [];
  // Version 100: stage 1 = Head of Department, stage 2 = HR Review.
  m.stagesByVersion = new Map([[100, [stage(100, 1, "Head of Department", ["approve", "return", "reject"]), stage(100, 2, "HR Review", ["approve", "reject"])]]]);
  m.resolves = new Map([
    [HOD_MEMBERSHIP, new Set(["100:1"])],
    [HR_MEMBERSHIP, new Set(["100:2"])],
  ]);
});

describe("listSubmissionsAwaitingViewer", () => {
  it("gives HR only forms at the HR stage; forms still with the Department Head are monitoring figures", async () => {
    m.rows = [row(1, { currentStageOrder: 1 }), row(2, { currentStageOrder: 2 }), row(3, { currentStageOrder: 1 })];

    const result = await listSubmissionsAwaitingViewer(ORG, viewer(HR_MEMBERSHIP, ["form.read"]));

    expect(result.awaiting.map((s) => s.id)).toEqual([2]);
    expect(result.awaiting[0]).toMatchObject({ stageName: "HR Review", subjectName: "Kofi Mensah" });
    expect(result.awaitingOthers).toBe(2);
  });

  it("gives the Department Head their stage, and no oversight count without form.read", async () => {
    m.rows = [row(1, { currentStageOrder: 1 }), row(2, { currentStageOrder: 2 })];

    const result = await listSubmissionsAwaitingViewer(ORG, viewer(HOD_MEMBERSHIP));

    expect(result.awaiting.map((s) => s.id)).toEqual([1]);
    expect(result.awaitingOthers).toBeNull();
  });

  it("reads only pending_approval submissions, so drafts (including HR-assisted drafts) are never tasks", async () => {
    await listSubmissionsAwaitingViewer(ORG, viewer(HR_MEMBERSHIP, ["form.read"]));
    expect(JSON.stringify(m.whereArgs)).toContain('"eq":["form_submissions.status","pending_approval"]');
    expect(JSON.stringify(m.whereArgs)).toContain(`"eq":["form_submissions.organizationId",${ORG}]`);
  });

  it("applies maker-checker: HR who raised the form on an employee's behalf is not its approver", async () => {
    m.rows = [row(4, { currentStageOrder: 2, createdByMembershipId: HR_MEMBERSHIP })];

    const result = await listSubmissionsAwaitingViewer(ORG, viewer(HR_MEMBERSHIP, ["form.read"]));

    expect(result.awaiting).toEqual([]);
    expect(result.awaitingOthers).toBe(1);
  });

  it("still gives a subject a stage whose only action is complete (e.g. employee acknowledgement)", async () => {
    m.stagesByVersion.set(200, [stage(200, 1, "Employee Acknowledgement", ["complete"])]);
    m.resolves.set(EMPLOYEE_MEMBERSHIP, new Set(["200:1"]));
    m.rows = [row(5, { templateVersionId: 200, currentStageOrder: 1, subjectEmployeeId: 777 })];

    const result = await listSubmissionsAwaitingViewer(ORG, viewer(EMPLOYEE_MEMBERSHIP, [], 777));

    expect(result.awaiting.map((s) => s.id)).toEqual([5]);
  });
});

describe("listVisibleSubmissions (shared stage helper)", () => {
  it("returns everything to a form.read holder without resolving stages", async () => {
    m.rows = [row(1), row(2, { status: "draft", currentStageOrder: null })];
    const visible = await listVisibleSubmissions(ORG, viewer(HR_MEMBERSHIP, ["form.read"]));
    expect(visible.map((s) => s.id)).toEqual([1, 2]);
    expect(m.listStagesCalls).toEqual([]);
  });

  it("returns own submissions plus those awaiting the viewer's stage, loading each version's stages once", async () => {
    m.rows = [
      row(1, { currentStageOrder: 1 }), // awaiting the HOD
      row(2, { currentStageOrder: 2 }), // at HR — not visible to the HOD
      row(3, { status: "draft", currentStageOrder: null, createdByMembershipId: HOD_MEMBERSHIP }), // own draft
      row(6, { currentStageOrder: 1 }), // awaiting the HOD
    ];
    const visible = await listVisibleSubmissions(ORG, viewer(HOD_MEMBERSHIP));
    expect(visible.map((s) => s.id)).toEqual([1, 3, 6]);
    expect(m.listStagesCalls).toEqual([100]);
  });
});
