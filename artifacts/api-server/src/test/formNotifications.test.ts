/**
 * In-app notifications for form workflow transitions (WS-26, S1).
 *
 * These tests are about WHO gets told and WHAT travels, because both are
 * security properties rather than cosmetics:
 *
 *   - recipients mirror the stage resolver, so nobody is notified about work
 *     they would be refused if they tried to do it;
 *   - maker-checker is honoured, so the person who raised a form is not invited
 *     to approve it;
 *   - an employee with no linked login produces no notification and no error —
 *     it is the ordinary assisted-form case, not a fault;
 *   - answer values and assistance notes never leave the form.
 *
 * Everything is mocked at the module boundary: these prove the composition
 * rules, not the notifications table (which lib/notifications.ts owns).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({
  notifyUser: vi.fn(),
  resolveRecipients: vi.fn(),
  getCurrentDepartmentHead: vi.fn(),
  /** Rows the fake notifications SELECT returns — the duplicate guard reads these. */
  pendingRows: [] as { id: number }[],
  /** Rows the fake employees/memberships SELECT returns. */
  scalarRows: [] as Record<string, unknown>[],
  warn: vi.fn(),
}));

vi.mock("@workspace/db", () => {
  const chain = () => {
    const c: Record<string, unknown> = {};
    c.from = (table: { __name?: string }) => {
      (c as { __table?: string }).__table = table?.__name;
      return c;
    };
    c.innerJoin = () => c;
    c.leftJoin = () => c;
    c.where = () => c;
    c.limit = () =>
      Promise.resolve((c as { __table?: string }).__table === "notifications" ? m.pendingRows : m.scalarRows);
    c.then = (resolve: (v: unknown) => unknown) => Promise.resolve(m.scalarRows).then(resolve);
    return c;
  };
  return {
    db: { select: () => chain(), selectDistinct: () => chain() },
    notificationsTable: { __name: "notifications", id: "id", userId: "userId", sourceReferenceType: "srt", sourceReferenceId: "sri", title: "title", read: "read" },
    organizationMembershipsTable: { __name: "memberships", id: "id", applicationUserId: "applicationUserId" },
    employeesTable: { __name: "employees", id: "id", organizationId: "organizationId", departmentId: "departmentId" },
  };
});

vi.mock("../lib/notifications", () => ({
  notifyUser: m.notifyUser,
  resolveRecipients: m.resolveRecipients,
}));

vi.mock("../lib/departmentHeads", () => ({ getCurrentDepartmentHead: m.getCurrentDepartmentHead }));
vi.mock("../lib/logger", () => ({ logger: { warn: m.warn, info: vi.fn(), error: vi.fn() } }));

import { notifyFormTransition } from "../lib/formEngine/formNotifications";

const ORG = 3;

const submission = (over: Record<string, unknown> = {}) =>
  ({
    id: 77,
    organizationId: ORG,
    subjectEmployeeId: 445,
    createdByMembershipId: 434,
    currentStageOrder: 1,
    status: "pending_approval",
    assisted: true,
    assistanceReason: "medical_or_incapacity",
    assistanceNotes: "Employee is in hospital following surgery",
    ...over,
  }) as never;

const stage = (over: Record<string, unknown> = {}) =>
  ({
    stageOrder: 1,
    name: "Employee Confirmation & Signature",
    resolver: "subject_employee",
    resolverConfig: {},
    allowedActions: ["complete"],
    signatureSlotKey: "employee_signature",
    ...over,
  }) as never;

const hrStage = () =>
  stage({ stageOrder: 2, name: "HR review", resolver: "permission_holder", resolverConfig: { permissionKey: "form.approve" }, allowedActions: ["approve", "return", "reject"], signatureSlotKey: null });

const call = (over: Record<string, unknown> = {}) =>
  notifyFormTransition({
    organizationId: ORG,
    submission: submission(),
    templateTitle: "Staff Personal Information Form",
    subjectName: "Kwame Owusu",
    stages: [stage()],
    kind: "stage_entered",
    ...over,
  } as never);

beforeEach(() => {
  vi.clearAllMocks();
  m.pendingRows = [];
  m.scalarRows = [];
  m.notifyUser.mockResolvedValue([{ id: 1 }]);
  m.resolveRecipients.mockResolvedValue([{ userId: 900 }]);
});

describe("subject-employee stage (A)", () => {
  it("notifies the subject employee when a form reaches their stage", async () => {
    const sent = await call();
    expect(sent).toBe(1);
    expect(m.resolveRecipients).toHaveBeenCalledWith({ kind: "employee", employeeId: 445 }, ORG);
    const payload = m.notifyUser.mock.calls[0]![0];
    expect(payload.recipient).toEqual({ kind: "user", userId: 900 });
    expect(payload.organizationId).toBe(ORG);
    expect(payload.actionPath).toBe("/forms/77");
  });

  it("creates nothing, and does not throw, when the employee has no linked account", async () => {
    m.resolveRecipients.mockRejectedValue(new Error("The resolved recipient has no active membership in this organization"));
    await expect(call()).resolves.toBe(0);
    expect(m.notifyUser).not.toHaveBeenCalled();
  });

  it("does not notify twice while the first notification is still unread", async () => {
    m.pendingRows = [{ id: 5 }];
    await expect(call()).resolves.toBe(0);
    expect(m.notifyUser).not.toHaveBeenCalled();
  });

  it("notifies the subject even though they raised the form themselves (a confirmation stage allows complete)", async () => {
    const sent = await call({ submission: submission({ createdByMembershipId: 999 }) });
    expect(sent).toBe(1);
  });
});

describe("permission-holder review stage (C)", () => {
  it("notifies holders of the stage permission, not everyone who can watch", async () => {
    m.resolveRecipients.mockImplementation(async (spec: { kind: string }) =>
      spec.kind === "permission_holders" ? [{ userId: 433 }, { userId: 434 }] : [],
    );
    const sent = await notifyFormTransition({
      organizationId: ORG,
      submission: submission({ currentStageOrder: 2 }),
      templateTitle: "Staff Personal Information Form",
      subjectName: "Kwame Owusu",
      stages: [stage(), hrStage()],
      kind: "stage_entered",
    } as never);
    expect(sent).toBe(2);
    expect(m.resolveRecipients).toHaveBeenCalledWith({ kind: "permission_holders", permissionKey: "form.approve" }, ORG);
  });

  it("excludes the HR user who raised the form — maker-checker would refuse them", async () => {
    // The creator membership resolves to user 434; the subject resolves to 800.
    m.scalarRows = [{ userId: 434 }];   // the projection aliases applicationUserId to userId
    m.resolveRecipients.mockImplementation(async (spec: { kind: string }) =>
      spec.kind === "permission_holders" ? [{ userId: 433 }, { userId: 434 }] : [{ userId: 800 }],
    );
    const sent = await notifyFormTransition({
      organizationId: ORG,
      submission: submission({ currentStageOrder: 2 }),
      templateTitle: "Staff Personal Information Form",
      subjectName: "Kwame Owusu",
      stages: [stage(), hrStage()],
      kind: "stage_entered",
    } as never);
    expect(sent).toBe(1);
    expect(m.notifyUser.mock.calls.map((c) => c[0].recipient.userId)).toEqual([433]);
  });

  it("excludes the subject employee from a decision stage about their own form", async () => {
    m.scalarRows = [{ userId: 434 }];   // the projection aliases applicationUserId to userId
    m.resolveRecipients.mockImplementation(async (spec: { kind: string }) =>
      spec.kind === "permission_holders" ? [{ userId: 800 }] : [{ userId: 800 }],
    );
    const sent = await notifyFormTransition({
      organizationId: ORG,
      submission: submission({ currentStageOrder: 2 }),
      templateTitle: "Staff Personal Information Form",
      subjectName: "Kwame Owusu",
      stages: [stage(), hrStage()],
      kind: "stage_entered",
    } as never);
    expect(sent).toBe(0);
  });
});

describe("returned and final outcomes (B, D)", () => {
  it.each([
    ["returned", "A form was returned to you"],
    ["approved", "Your form was approved"],
    ["rejected", "Your form was not approved"],
    ["finalized", "Your form is complete"],
  ])("%s notifies the subject employee", async (kind, title) => {
    const sent = await call({ kind, submission: submission({ currentStageOrder: null, status: "returned" }) });
    expect(sent).toBe(1);
    expect(m.resolveRecipients).toHaveBeenCalledWith({ kind: "employee", employeeId: 445 }, ORG);
    expect(m.notifyUser.mock.calls[0]![0].title).toBe(title);
  });
});

describe("what travels", () => {
  it("never carries assistance notes or answer values", async () => {
    await call();
    const payload = JSON.stringify(m.notifyUser.mock.calls[0]![0]);
    expect(payload).not.toMatch(/hospital|surgery/i);
    expect(payload).not.toMatch(/assistanceNotes|assistance_notes/);
    expect(payload).not.toMatch(/answers/);
  });

  it("is written for a person, not a developer", async () => {
    await call();
    const { title, message } = m.notifyUser.mock.calls[0]![0];
    for (const jargon of ["subject_employee", "resolver", "membership", "application_user_id", "permission_holder"]) {
      expect(`${title} ${message}`).not.toContain(jargon);
    }
    expect(message).toContain("Staff Personal Information Form");
    expect(message).toContain("Kwame Owusu");
  });

  it("scopes every notification to the submission's own organization", async () => {
    await call();
    expect(m.notifyUser.mock.calls[0]![0].organizationId).toBe(ORG);
    for (const [spec, org] of m.resolveRecipients.mock.calls) {
      expect(org).toBe(ORG);
      expect(spec).toBeTruthy();
    }
  });
});

describe("never breaks the workflow", () => {
  it("swallows and logs an unexpected failure rather than propagating it", async () => {
    m.notifyUser.mockRejectedValue(new Error("notifications table is unavailable"));
    await expect(call()).resolves.toBe(0);
    expect(m.warn).toHaveBeenCalled();
  });

  it("does nothing when the stage is not one it can resolve an actor for", async () => {
    const sent = await call({ stages: [stage({ resolver: "specific_membership", resolverConfig: {} })] });
    expect(sent).toBe(0);
    expect(m.notifyUser).not.toHaveBeenCalled();
  });

  it("does nothing when the submission is not sitting at a stage", async () => {
    const sent = await call({ submission: submission({ currentStageOrder: null }) });
    expect(sent).toBe(0);
    expect(m.notifyUser).not.toHaveBeenCalled();
  });
});
