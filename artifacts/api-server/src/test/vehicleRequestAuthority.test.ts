/**
 * VR-02A — "may this membership decide this stage?"
 *
 * This is the security-critical half of VR-02: every approval that will ever
 * happen passes through `resolveStageAuthority`. The tests below prove each
 * resolver independently AND prove the composition rule by failing each of its
 * terms on its own — a resolver match without the permission, and the
 * permission without a resolver match, must both come back as no authority.
 *
 * `authorityDelegations` is mocked at the module boundary because its own
 * delegation semantics (validity windows, revocation, inactive delegates) are
 * already proven by its own suite; what is under test here is how VR-02
 * COMPOSES it, not a second copy of it.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const { state } = vi.hoisted(() => ({
  state: {
    memberships: [] as { id: number; organizationId: number; status: string }[],
    permissions: new Map<number, Set<string>>(),
    /** departmentId -> the authority resolveDepartmentHeadAuthority reports, per actor. */
    headAuthority: new Map<string, { basis: "direct" | "delegated"; directAuthorityHolderMembershipId: number; delegationId: number | null }>(),
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: unknown) => ({ __op: "eq", field: String(col).split(".").pop(), val }),
  and: (...conds: unknown[]) => ({ __op: "and", conds: conds.filter(Boolean) }),
}));

vi.mock("@workspace/db", () => {
  const organizationMembershipsTable = { __name: "organization_memberships", id: "m.id", organizationId: "m.organizationId", status: "m.status" };
  type Cond = { __op: string; field?: string; val?: unknown; conds?: Cond[] };
  const matches = (row: Record<string, unknown>, cond: Cond): boolean => {
    if (!cond) return true;
    if (cond.__op === "eq") return row[cond.field!] === cond.val;
    if (cond.__op === "and") return (cond.conds ?? []).every((c) => matches(row, c));
    return true;
  };
  return {
    organizationMembershipsTable,
    db: {
      select: () => ({
        from: () => {
          let rows = state.memberships as Record<string, unknown>[];
          const builder = {
            where(cond: Cond) {
              rows = rows.filter((r) => matches(r, cond));
              return builder;
            },
            limit: (n: number) => Promise.resolve(rows.slice(0, n)),
          };
          return builder;
        },
      }),
    },
  };
});

vi.mock("../lib/authorityDelegations", () => ({
  resolveDepartmentHeadAuthority: vi.fn(async (_org: number, departmentId: number, actorMembershipId: number) =>
    state.headAuthority.get(`${departmentId}:${actorMembershipId}`) ?? null,
  ),
}));

vi.mock("../lib/permissions", () => ({
  hasPermission: vi.fn(async (membershipId: number, key: string) => state.permissions.get(membershipId)?.has(key) ?? false),
}));

const { resolveStageAuthority, resolveApprovalAuthority, readPermissionHolderConfig, readSpecificMembershipConfig } =
  await import("../lib/vehicleRequestAuthority");

const ORG = 10;
const DEPARTMENT = 5;
const HEAD = 100;
const DELEGATE = 101;
const OFFICER = 102;
const STRANGER = 103;
const INACTIVE = 104;

const request = { requestingDepartmentId: DEPARTMENT };

beforeEach(() => {
  state.memberships = [
    { id: HEAD, organizationId: ORG, status: "active" },
    { id: DELEGATE, organizationId: ORG, status: "active" },
    { id: OFFICER, organizationId: ORG, status: "active" },
    { id: STRANGER, organizationId: ORG, status: "active" },
    { id: INACTIVE, organizationId: ORG, status: "revoked" },
    { id: 900, organizationId: 20, status: "active" }, // another organization
  ];
  state.permissions = new Map([
    [HEAD, new Set(["vehicle_request.approve"])],
    [DELEGATE, new Set(["vehicle_request.approve"])],
    [OFFICER, new Set(["vehicle_request.approve", "asset_management.manage"])],
    [STRANGER, new Set<string>()],
    [INACTIVE, new Set(["vehicle_request.approve"])],
  ]);
  state.headAuthority = new Map([
    [`${DEPARTMENT}:${HEAD}`, { basis: "direct" as const, directAuthorityHolderMembershipId: HEAD, delegationId: null }],
    [`${DEPARTMENT}:${DELEGATE}`, { basis: "delegated" as const, directAuthorityHolderMembershipId: HEAD, delegationId: 7 }],
  ]);
});

describe("resolver config readers", () => {
  it("accepts only a non-empty string permissionKey", () => {
    expect(readPermissionHolderConfig({ permissionKey: "vehicle_request.approve" })).toEqual({ permissionKey: "vehicle_request.approve" });
    expect(readPermissionHolderConfig({ permissionKey: "   " })).toBeNull();
    expect(readPermissionHolderConfig({ permissionKey: 7 })).toBeNull();
    expect(readPermissionHolderConfig(null)).toBeNull();
  });

  it("accepts only a positive integer membershipId", () => {
    expect(readSpecificMembershipConfig({ membershipId: 5 })).toEqual({ membershipId: 5 });
    expect(readSpecificMembershipConfig({ membershipId: 0 })).toBeNull();
    expect(readSpecificMembershipConfig({ membershipId: "5" })).toBeNull();
    expect(readSpecificMembershipConfig(undefined)).toBeNull();
  });
});

describe("department_head resolver", () => {
  const stage = { resolverType: "department_head" as const, resolverConfig: {} };

  it("resolves the current head of the request's own department", async () => {
    const authority = await resolveStageAuthority({ organizationId: ORG, stage, request, actorMembershipId: HEAD });
    expect(authority).toEqual({ resolverType: "department_head", actedAsDelegate: false, delegatorHeadMembershipId: null });
  });

  it("resolves a currently-valid delegate, and says whose authority they used", async () => {
    const authority = await resolveStageAuthority({ organizationId: ORG, stage, request, actorMembershipId: DELEGATE });
    // The record must never read as though the head acted personally.
    expect(authority).toEqual({ resolverType: "department_head", actedAsDelegate: true, delegatorHeadMembershipId: HEAD });
  });

  it("resolves nobody when the department is vacant — never a fallback approver", async () => {
    state.headAuthority.clear();
    expect(await resolveStageAuthority({ organizationId: ORG, stage, request, actorMembershipId: HEAD })).toBeNull();
    expect(await resolveStageAuthority({ organizationId: ORG, stage, request, actorMembershipId: DELEGATE })).toBeNull();
  });

  it("resolves nobody once a delegation has ended", async () => {
    // Expiry/revocation is decided inside authorityDelegations; VR-02 simply
    // believes its "no".
    state.headAuthority.delete(`${DEPARTMENT}:${DELEGATE}`);
    expect(await resolveStageAuthority({ organizationId: ORG, stage, request, actorMembershipId: DELEGATE })).toBeNull();
  });

  it("uses the department stored on the REQUEST, not any live lookup", async () => {
    state.headAuthority.set(`99:${STRANGER}`, { basis: "direct", directAuthorityHolderMembershipId: STRANGER, delegationId: null });
    // Head of department 99 is not the head of this request's department 5.
    expect(await resolveStageAuthority({ organizationId: ORG, stage, request, actorMembershipId: STRANGER })).toBeNull();
    const other = await resolveStageAuthority({
      organizationId: ORG,
      stage,
      request: { requestingDepartmentId: 99 },
      actorMembershipId: STRANGER,
    });
    expect(other?.resolverType).toBe("department_head");
  });
});

describe("permission_holder resolver", () => {
  const stage = { resolverType: "permission_holder" as const, resolverConfig: { permissionKey: "asset_management.manage" } };

  it("resolves anyone currently holding the named key", async () => {
    const authority = await resolveStageAuthority({ organizationId: ORG, stage, request, actorMembershipId: OFFICER });
    expect(authority).toEqual({ resolverType: "permission_holder", actedAsDelegate: false, delegatorHeadMembershipId: null });
  });

  it("resolves nobody else, including the department head", async () => {
    expect(await resolveStageAuthority({ organizationId: ORG, stage, request, actorMembershipId: HEAD })).toBeNull();
    expect(await resolveStageAuthority({ organizationId: ORG, stage, request, actorMembershipId: STRANGER })).toBeNull();
  });

  it("authorizes nobody when the config is malformed", async () => {
    for (const resolverConfig of [null, {}, { permissionKey: "" }, { wrong: "shape" }]) {
      const authority = await resolveStageAuthority({
        organizationId: ORG,
        stage: { resolverType: "permission_holder", resolverConfig },
        request,
        actorMembershipId: OFFICER,
      });
      expect(authority).toBeNull();
    }
  });
});

describe("specific_membership resolver", () => {
  const stage = { resolverType: "specific_membership" as const, resolverConfig: { membershipId: OFFICER } };

  it("resolves exactly that membership and no other", async () => {
    expect(await resolveStageAuthority({ organizationId: ORG, stage, request, actorMembershipId: OFFICER })).toEqual({
      resolverType: "specific_membership",
      actedAsDelegate: false,
      delegatorHeadMembershipId: null,
    });
    expect(await resolveStageAuthority({ organizationId: ORG, stage, request, actorMembershipId: HEAD })).toBeNull();
  });

  it("authorizes nobody when the config is malformed", async () => {
    const authority = await resolveStageAuthority({
      organizationId: ORG,
      stage: { resolverType: "specific_membership", resolverConfig: {} },
      request,
      actorMembershipId: OFFICER,
    });
    expect(authority).toBeNull();
  });
});

describe("membership state gates every resolver", () => {
  it("an inactive membership satisfies nothing, whatever a stage names", async () => {
    state.headAuthority.set(`${DEPARTMENT}:${INACTIVE}`, { basis: "direct", directAuthorityHolderMembershipId: INACTIVE, delegationId: null });
    state.permissions.set(INACTIVE, new Set(["asset_management.manage", "vehicle_request.approve"]));
    for (const stage of [
      { resolverType: "department_head" as const, resolverConfig: {} },
      { resolverType: "permission_holder" as const, resolverConfig: { permissionKey: "asset_management.manage" } },
      { resolverType: "specific_membership" as const, resolverConfig: { membershipId: INACTIVE } },
    ]) {
      expect(await resolveStageAuthority({ organizationId: ORG, stage, request, actorMembershipId: INACTIVE })).toBeNull();
    }
  });

  it("a membership from another organization satisfies nothing", async () => {
    const stage = { resolverType: "specific_membership" as const, resolverConfig: { membershipId: 900 } };
    expect(await resolveStageAuthority({ organizationId: ORG, stage, request, actorMembershipId: 900 })).toBeNull();
  });
});

describe("the composition rule — both terms are required", () => {
  const stage = { resolverType: "department_head" as const, resolverConfig: {} };

  it("resolver match WITHOUT vehicle_request.approve yields no authority", async () => {
    state.permissions.set(HEAD, new Set()); // still the head, but holds nothing
    expect(await resolveStageAuthority({ organizationId: ORG, stage, request, actorMembershipId: HEAD })).not.toBeNull();
    expect(await resolveApprovalAuthority({ organizationId: ORG, stage, request, actorMembershipId: HEAD })).toBeNull();
  });

  it("vehicle_request.approve WITHOUT a resolver match yields no authority", async () => {
    state.permissions.set(STRANGER, new Set(["vehicle_request.approve"]));
    expect(await resolveApprovalAuthority({ organizationId: ORG, stage, request, actorMembershipId: STRANGER })).toBeNull();
  });

  it("both terms together yield authority, with the delegate attribution preserved", async () => {
    const authority = await resolveApprovalAuthority({ organizationId: ORG, stage, request, actorMembershipId: DELEGATE });
    expect(authority).toEqual({ resolverType: "department_head", actedAsDelegate: true, delegatorHeadMembershipId: HEAD });
  });

  it("a delegation never supplies the permission itself", async () => {
    // The delegate is a valid substitute but holds no key of their own.
    state.permissions.set(DELEGATE, new Set());
    expect(await resolveApprovalAuthority({ organizationId: ORG, stage, request, actorMembershipId: DELEGATE })).toBeNull();
  });
});
