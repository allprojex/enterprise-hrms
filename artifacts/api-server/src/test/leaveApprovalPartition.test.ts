/**
 * partitionPendingApprovalsForActor — the monitor-versus-action rule for Leave.
 *
 * listPendingApprovals hands HR both stages so HR can monitor the queue. Only
 * the stage the actor can actually decide — the rule approveLeaveRequest and
 * rejectLeaveRequest enforce — may be presented as that actor's work:
 *
 *   pending    → the employee's current Department Head only;
 *   pending_hr → a leave_request.manage holder only;
 *   never the actor's own request.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({
  employees: [] as { id: number; departmentId: number | null }[],
  headed: [] as number[],
  selectCalls: 0,
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: () => {
      m.selectCalls += 1;
      return { from: () => ({ where: async () => m.employees }) };
    },
  },
  employeesTable: { id: "e.id", departmentId: "e.departmentId", organizationId: "e.organizationId" },
  leaveRequestsTable: {},
  leavePoliciesTable: {},
}));
vi.mock("drizzle-orm", () => ({
  and: (...c: unknown[]) => ({ and: c }),
  eq: (a: unknown, b: unknown) => ({ eq: [a, b] }),
  inArray: (a: unknown, b: unknown) => ({ inArray: [a, b] }),
  desc: (a: unknown) => ({ desc: a }),
}));
vi.mock("../lib/departmentHeads", () => ({
  resolveDepartmentHeadIdentity: vi.fn(),
  listDepartmentsHeadedByMembership: async () => m.headed,
}));
vi.mock("../lib/auditLog", () => ({ recordAuditEvent: vi.fn() }));
vi.mock("../lib/leaveBalances", () => ({ getAvailableBalance: vi.fn(), postApprovedUsageEntry: vi.fn() }));
vi.mock("../lib/leaveRequests", () => ({ LeaveRequestNotFoundError: class extends Error {} }));

import { partitionPendingApprovalsForActor } from "../lib/leaveApprovals";
import type { LeaveRequest } from "@workspace/db";

function request(id: number, employeeId: number, status: "pending" | "pending_hr"): LeaveRequest {
  return { id, employeeId, status } as LeaveRequest;
}

const ids = (rows: LeaveRequest[]) => rows.map((r) => r.id);

beforeEach(() => {
  m.employees = [
    { id: 100, departmentId: 5 },
    { id: 200, departmentId: 6 },
    { id: 300, departmentId: null },
  ];
  m.headed = [];
  m.selectCalls = 0;
});

describe("partitionPendingApprovalsForActor", () => {
  const queue = [
    request(1, 100, "pending"), // with the Department Head of dept 5
    request(2, 200, "pending"), // with the Department Head of dept 6
    request(3, 100, "pending_hr"), // Department Head approved → HR review
    request(4, 300, "pending"), // no department at all
  ];

  it("HR who heads no department: HOD-stage requests are monitor-only, HR-stage requests are actionable", async () => {
    const split = await partitionPendingApprovalsForActor(10, queue, { membershipId: 70, employeeId: 999, isHr: true });
    expect(ids(split.actionable)).toEqual([3]);
    expect(ids(split.awaitingOtherStage)).toEqual([1, 2, 4]);
  });

  it("HR who also heads department 5 may act on that department's HOD stage, not on another department's", async () => {
    m.headed = [5];
    const split = await partitionPendingApprovalsForActor(10, queue, { membershipId: 70, employeeId: 999, isHr: true });
    expect(ids(split.actionable)).toEqual([1, 3]);
    expect(ids(split.awaitingOtherStage)).toEqual([2, 4]);
  });

  it("a plain Department Head acts on their department's HOD stage but never on the HR stage", async () => {
    m.headed = [6];
    const split = await partitionPendingApprovalsForActor(10, queue, { membershipId: 71, employeeId: 998, isHr: false });
    expect(ids(split.actionable)).toEqual([2]);
    expect(ids(split.awaitingOtherStage)).toEqual([1, 3, 4]);
  });

  it("never makes the actor's own request their task, at either stage", async () => {
    m.headed = [5];
    const own = [request(5, 100, "pending"), request(6, 100, "pending_hr")];
    const split = await partitionPendingApprovalsForActor(10, own, { membershipId: 70, employeeId: 100, isHr: true });
    expect(split.actionable).toEqual([]);
    expect(ids(split.awaitingOtherStage)).toEqual([5, 6]);
  });

  it("does no lookup for an empty queue or an HR-stage-only queue", async () => {
    expect(await partitionPendingApprovalsForActor(10, [], { membershipId: 70, employeeId: null, isHr: true })).toEqual({ actionable: [], awaitingOtherStage: [] });
    const split = await partitionPendingApprovalsForActor(10, [request(7, 200, "pending_hr")], { membershipId: 70, employeeId: null, isHr: true });
    expect(ids(split.actionable)).toEqual([7]);
    expect(m.selectCalls).toBe(0);
  });
});
