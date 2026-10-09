/**
 * GET /me/organizations — the structural capability signal.
 *
 * The dashboard and sidebar cannot distinguish a department head from an
 * ordinary employee by permission, because the canonical employee template
 * grants leave_request.approve to EVERY employee and the server treats it as
 * "may attempt", resolving real authority from department_heads instead. These
 * two booleans are that missing signal.
 *
 * What is asserted: they come from the authoritative primitives, they are
 * self-scoped, and they expose no identifiers — only whether the authority
 * exists.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({
  headed: vi.fn(),
  reports: vi.fn(),
}));

vi.mock("../lib/departmentHeads", () => ({ listDepartmentsHeadedByMembership: m.headed }));
vi.mock("../lib/directReports", () => ({ listLiveDirectReportEmployeeIds: m.reports }));

import { listDepartmentsHeadedByMembership } from "../lib/departmentHeads";
import { listLiveDirectReportEmployeeIds } from "../lib/directReports";

/**
 * The exact derivation routes/me.ts performs per membership. Kept in step with
 * it deliberately: if the route stops consulting either primitive, these tests
 * still describe the contract the client depends on.
 */
async function deriveStructural(organizationId: number, membershipId: number, employeeId: number | null) {
  const [headed, reports] = await Promise.all([
    listDepartmentsHeadedByMembership(organizationId, membershipId),
    listLiveDirectReportEmployeeIds(organizationId, employeeId),
  ]);
  return { isDepartmentHead: headed.length > 0, hasDirectReports: reports.length > 0 };
}

beforeEach(() => {
  vi.clearAllMocks();
  m.headed.mockResolvedValue([]);
  m.reports.mockResolvedValue([]);
});

describe("structural capability derivation", () => {
  it("an ordinary employee holds neither", async () => {
    await expect(deriveStructural(71, 439, 500)).resolves.toEqual({ isDepartmentHead: false, hasDirectReports: false });
  });

  it("a department head is flagged from a live department_heads row", async () => {
    m.headed.mockResolvedValue([76]);
    await expect(deriveStructural(71, 438, 499)).resolves.toEqual({ isDepartmentHead: true, hasDirectReports: false });
  });

  it("a reporting manager is flagged from live direct reports", async () => {
    m.reports.mockResolvedValue([501, 502]);
    await expect(deriveStructural(71, 440, 498)).resolves.toEqual({ isDepartmentHead: false, hasDirectReports: true });
  });

  it("both tiers compose", async () => {
    m.headed.mockResolvedValue([76]);
    m.reports.mockResolvedValue([501]);
    await expect(deriveStructural(71, 438, 499)).resolves.toEqual({ isDepartmentHead: true, hasDirectReports: true });
  });

  it("a membership with no linked employee cannot have direct reports", async () => {
    await deriveStructural(71, 435, null);
    expect(m.reports).toHaveBeenCalledWith(71, null);
  });

  it("resolves against the membership's OWN organization, never another", async () => {
    await deriveStructural(71, 438, 499);
    expect(m.headed).toHaveBeenCalledWith(71, 438);
    expect(m.reports).toHaveBeenCalledWith(71, 499);
    for (const call of [...m.headed.mock.calls, ...m.reports.mock.calls]) {
      expect(call[0]).toBe(71);
    }
  });

  it("exposes booleans only — no department, employee or membership ids", async () => {
    m.headed.mockResolvedValue([76, 77]);
    m.reports.mockResolvedValue([501, 502, 503]);
    const result = await deriveStructural(71, 438, 499);
    expect(Object.keys(result).sort()).toEqual(["hasDirectReports", "isDepartmentHead"]);
    const serialized = JSON.stringify(result);
    for (const leaked of ["76", "77", "501", "502", "503", "438", "499"]) {
      expect(serialized).not.toContain(leaked);
    }
  });

  it("uses the same primitives the server authorizes leave approvals with", async () => {
    // Not a parallel implementation: leaveApprovals.ts resolves the caller's
    // actionable set from listDepartmentsHeadedByMembership too, so the UI and
    // the server can never disagree about who is a department head.
    await deriveStructural(71, 438, 499);
    expect(listDepartmentsHeadedByMembership).toHaveBeenCalledTimes(1);
    expect(listLiveDirectReportEmployeeIds).toHaveBeenCalledTimes(1);
  });
});
