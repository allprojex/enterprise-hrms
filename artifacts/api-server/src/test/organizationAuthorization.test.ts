import { describe, it, expect, vi, beforeEach } from "vitest";

const { getActiveMembershipMock, hasPermissionMock } = vi.hoisted(() => ({
  getActiveMembershipMock: vi.fn(),
  hasPermissionMock: vi.fn(),
}));

vi.mock("../lib/membership", () => ({ getActiveMembership: getActiveMembershipMock }));
vi.mock("../lib/permissions", () => ({ hasPermission: hasPermissionMock }));

const { authorizeOrganizationAction } = await import("../lib/organizationAuthorization");

function makeUser(overrides: Partial<{ id: number; role: string; organizationId: number }> = {}) {
  return {
    id: 1,
    role: "employee",
    organizationId: 10,
    ...overrides,
  } as Parameters<typeof authorizeOrganizationAction>[0];
}

beforeEach(() => {
  getActiveMembershipMock.mockReset();
  hasPermissionMock.mockReset();
});

describe("authorizeOrganizationAction", () => {
  it("allows super_admin without checking membership or permissions (cross-org bypass)", async () => {
    const user = makeUser({ role: "super_admin" });

    const allowed = await authorizeOrganizationAction(user, 999, "organization.update");

    expect(allowed).toBe(true);
    expect(getActiveMembershipMock).not.toHaveBeenCalled();
    expect(hasPermissionMock).not.toHaveBeenCalled();
  });

  it("denies a non-member of the target organization (fails closed)", async () => {
    getActiveMembershipMock.mockResolvedValue(null);
    const user = makeUser({ organizationId: 10 });

    const allowed = await authorizeOrganizationAction(user, 20, "organization.read");

    expect(allowed).toBe(false);
    expect(hasPermissionMock).not.toHaveBeenCalled();
  });

  it("denies a member of the target organization who lacks the permission", async () => {
    getActiveMembershipMock.mockResolvedValue({ id: 5, organizationId: 10 });
    hasPermissionMock.mockResolvedValue(false);
    const user = makeUser({ organizationId: 10 });

    const allowed = await authorizeOrganizationAction(user, 10, "organization.update");

    expect(allowed).toBe(false);
    expect(hasPermissionMock).toHaveBeenCalledWith(5, "organization.update");
  });

  it("allows a member of the target organization who has the permission", async () => {
    getActiveMembershipMock.mockResolvedValue({ id: 5, organizationId: 10 });
    hasPermissionMock.mockResolvedValue(true);
    const user = makeUser({ organizationId: 10 });

    const allowed = await authorizeOrganizationAction(user, 10, "organization.read");

    expect(allowed).toBe(true);
  });

  it("enforces tenant isolation: a membership in one org does not grant access to another", async () => {
    // getActiveMembership is looked up for the *target* org, not the user's own -- a
    // membership only in org 10 resolves to null when org 20 is requested.
    getActiveMembershipMock.mockImplementation((_userId: number, organizationId: number) =>
      Promise.resolve(organizationId === 10 ? { id: 5, organizationId: 10 } : null),
    );
    hasPermissionMock.mockResolvedValue(true);
    const user = makeUser({ organizationId: 10 });

    expect(await authorizeOrganizationAction(user, 10, "organization.read")).toBe(true);
    expect(await authorizeOrganizationAction(user, 20, "organization.read")).toBe(false);
  });
});
