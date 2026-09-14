/**
 * Leave ↔ Leave-Application-Form linkage (Owner Decision D1/D2).
 *
 * The point of these tests is what the module must NEVER do. `leave_requests`
 * is the sole owner of leave status, approval and balances; the form is a
 * signed documentary representation. So the assertions are mostly negative:
 * no status write, no balance write, no second approval lifecycle, no
 * cross-tenant join, no linking a form about one employee to another
 * employee's leave.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { state, leaveRequestsTable, formSubmissionsTable } = vi.hoisted(() => {
  const mockTable = (name: string, cols: string[]) => {
    const t: Record<string, string> & { __name: string } = { __name: name } as never;
    for (const c of cols) t[c] = `${name}.${c}`;
    return t;
  };
  return {
    leaveRequestsTable: mockTable("leave_requests", ["id", "organizationId", "employeeId", "leaveTypeId", "startDate", "endDate", "daysRequested", "reason", "status"]),
    formSubmissionsTable: mockTable("form_submissions", ["id", "organizationId", "subjectEmployeeId"]),
    state: {
      leaveRows: [] as Record<string, unknown>[],
      submissionRows: [] as Record<string, unknown>[],
      writes: [] as { table: string; values: unknown }[],
      links: [] as Record<string, unknown>[],
    },
  };
});

vi.mock("@workspace/db", () => {
  const matches = (row: Record<string, unknown>, cond: unknown): boolean => {
    if (!cond || typeof cond !== "object") return true;
    const c = cond as { __op: string; field?: string; val?: unknown; conds?: unknown[] };
    if (c.__op === "and") return (c.conds ?? []).every((x) => matches(row, x));
    if (c.__op === "eq") return row[c.field as string] === c.val;
    return true;
  };
  // Applies the SELECT projection the way drizzle does: { alias: table.column }
  // becomes { alias: row[column] }. Without this the mock returns raw rows and a
  // projection-dependent bug would pass silently.
  const project = (row: Record<string, unknown>, projection: Record<string, string> | undefined) => {
    if (!projection) return row;
    const out: Record<string, unknown> = {};
    for (const [alias, col] of Object.entries(projection)) out[alias] = row[String(col).split(".").pop() as string];
    return out;
  };
  const builder = (rows: Record<string, unknown>[], projection?: Record<string, string>) => {
    const b: Record<string, unknown> = {};
    let table = "";
    let where: unknown;
    b.from = (t: { __name: string }) => {
      table = t.__name;
      return b;
    };
    b.where = (c: unknown) => {
      where = c;
      return b;
    };
    const run = () => rows.filter((r) => r.__table === table && matches(r, where)).map((r) => project(r, projection));
    b.limit = () => Promise.resolve(run());
    b.then = (res: (v: unknown[]) => unknown) => res(run());
    return b;
  };
  return {
    db: {
      select: (projection?: Record<string, string>) => builder([...state.leaveRows, ...state.submissionRows], projection),
      insert: (t: { __name: string }) => ({
        values: (v: unknown) => {
          state.writes.push({ table: t.__name, values: v });
          return { returning: () => Promise.resolve([{ id: 99, ...(v as object) }]) };
        },
      }),
      update: (t: { __name: string }) => ({
        set: (v: unknown) => {
          state.writes.push({ table: t.__name, values: v });
          return { where: () => ({ returning: () => Promise.resolve([]) }) };
        },
      }),
    },
    leaveRequestsTable,
    formSubmissionsTable,
  };
});

vi.mock("../lib/formEngine/domainLinks", () => ({
  listSubmissionLinks: vi.fn(async () => state.links),
  createSubmissionLink: vi.fn(async (p: Record<string, unknown>) => {
    const row = { id: 501, ...p };
    state.links.push(row);
    return row;
  }),
}));

vi.mock("drizzle-orm", () => ({
  and: (...conds: unknown[]) => ({ __op: "and", conds }),
  eq: (field: string, val: unknown) => ({ __op: "eq", field: String(field).split(".").pop(), val }),
}));

import { linkSubmissionToLeaveRequest, getLeaveRequestForPrefill, LeaveFormLinkError, LEAVE_FORM_RELATION } from "../lib/formEngine/leaveFormLink";
import { createSubmissionLink } from "../lib/formEngine/domainLinks";

const ACTOR = { userId: 434, membershipId: 434 };

beforeEach(() => {
  state.leaveRows = [
    { __table: "leave_requests", id: 10, organizationId: 3, employeeId: 439, leaveTypeId: 8, startDate: "2027-03-10", endDate: "2027-03-11", daysRequested: "2.00", reason: "Family", status: "pending" },
    // another tenant's request, same id space
    { __table: "leave_requests", id: 11, organizationId: 4, employeeId: 999, leaveTypeId: 1, startDate: "2027-03-10", endDate: "2027-03-11", daysRequested: "1.00", reason: null, status: "pending" },
  ];
  state.submissionRows = [
    { __table: "form_submissions", id: 70, organizationId: 3, subjectEmployeeId: 439 },
    { __table: "form_submissions", id: 71, organizationId: 3, subjectEmployeeId: 440 },
    { __table: "form_submissions", id: 72, organizationId: 4, subjectEmployeeId: 999 },
  ];
  state.writes = [];
  state.links = [];
  vi.mocked(createSubmissionLink).mockClear();
});

describe("prefill from the canonical leave request", () => {
  it("reads the canonical record so the form does not require re-entry", async () => {
    const p = await getLeaveRequestForPrefill(3, 10);
    expect(p).toMatchObject({ leaveRequestId: 10, employeeId: 439, leaveTypeId: 8, daysRequested: "2.00", status: "pending" });
  });

  it("is organization-scoped — another tenant's request is simply absent", async () => {
    expect(await getLeaveRequestForPrefill(3, 11)).toBeNull();
  });

  it("never writes anything while reading", async () => {
    await getLeaveRequestForPrefill(3, 10);
    expect(state.writes).toHaveLength(0);
  });
});

describe("linking a submission to a leave request", () => {
  it("links when both sides are in the caller's organization and concern the same employee", async () => {
    const link = await linkSubmissionToLeaveRequest({ organizationId: 3, submissionId: 70, leaveRequestId: 10, actor: ACTOR });
    expect(link).toMatchObject({ domainType: "leave_request", domainEntityId: 10, relationType: LEAVE_FORM_RELATION });
    expect(createSubmissionLink).toHaveBeenCalledTimes(1);
  });

  it("is idempotent — linking the same pair twice does not create a second link", async () => {
    await linkSubmissionToLeaveRequest({ organizationId: 3, submissionId: 70, leaveRequestId: 10, actor: ACTOR });
    vi.mocked(createSubmissionLink).mockClear();
    const again = await linkSubmissionToLeaveRequest({ organizationId: 3, submissionId: 70, leaveRequestId: 10, actor: ACTOR });
    expect(createSubmissionLink).not.toHaveBeenCalled();
    expect(again).toMatchObject({ domainEntityId: 10 });
  });

  it("refuses a leave request belonging to another organization", async () => {
    await expect(linkSubmissionToLeaveRequest({ organizationId: 3, submissionId: 70, leaveRequestId: 11, actor: ACTOR })).rejects.toBeInstanceOf(LeaveFormLinkError);
    expect(createSubmissionLink).not.toHaveBeenCalled();
  });

  it("refuses a submission belonging to another organization", async () => {
    await expect(linkSubmissionToLeaveRequest({ organizationId: 3, submissionId: 72, leaveRequestId: 10, actor: ACTOR })).rejects.toBeInstanceOf(LeaveFormLinkError);
  });

  it("refuses to file employee A's form as the record of employee B's leave", async () => {
    // submission 71 is about employee 440; leave 10 belongs to employee 439.
    await expect(linkSubmissionToLeaveRequest({ organizationId: 3, submissionId: 71, leaveRequestId: 10, actor: ACTOR })).rejects.toThrow(/not the employee this leave request belongs to/);
    expect(createSubmissionLink).not.toHaveBeenCalled();
  });

  it("NEVER writes to leave_requests — no status, no balance, no second lifecycle", async () => {
    await linkSubmissionToLeaveRequest({ organizationId: 3, submissionId: 70, leaveRequestId: 10, actor: ACTOR });
    expect(state.writes.filter((w) => w.table === "leave_requests")).toHaveLength(0);
    expect(state.writes).toHaveLength(0);
  });

  it("writes nothing at all when it refuses", async () => {
    await expect(linkSubmissionToLeaveRequest({ organizationId: 3, submissionId: 70, leaveRequestId: 11, actor: ACTOR })).rejects.toThrow();
    expect(state.writes).toHaveLength(0);
  });
});
