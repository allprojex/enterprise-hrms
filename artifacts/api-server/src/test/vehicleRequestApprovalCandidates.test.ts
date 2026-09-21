/**
 * VR-02A — who may be named by a `specific_membership` approval stage.
 *
 * The selector exists because a named person who does not hold
 * `vehicle_request.approve` can never resolve: approval re-checks that
 * permission at decision time, so such a stage would strand every request that
 * reached it. These assertions pin the three things that makes true — active
 * membership, permission possession resolved BY KEY rather than by role name,
 * and a response carrying nothing beyond the identity the picker needs.
 *
 * The fake below models the join relationally rather than stubbing the result,
 * so the filters are genuinely exercised. `activeAndUnexpired()` is NOT mocked:
 * the real predicate composes through these operators, which is what proves the
 * service reuses the repository's canonical notion of "active" instead of
 * inventing a second one.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const { fixtures, tables } = vi.hoisted(() => {
  const mk = (name: string, cols: string[]) => {
    const t: Record<string, string> & { __name: string } = { __name: name } as never;
    for (const c of cols) t[c] = `${name}.${c}`;
    return t;
  };
  return {
    fixtures: {
      rows: {} as Record<string, Record<string, unknown>[]>,
    },
    tables: {
      organizationMembershipsTable: mk("organization_memberships", [
        "id",
        "organizationId",
        "applicationUserId",
        "status",
        "expiresAt",
      ]),
      usersTable: mk("users", ["id", "firstName", "lastName"]),
      membershipRolesTable: mk("membership_roles", ["membershipId", "roleId"]),
      rolePermissionsTable: mk("role_permissions", ["roleId", "permissionId"]),
      permissionsTable: mk("permissions", ["id", "key"]),
      vehicleRequestApprovalStagesTable: mk("vehicle_request_approval_stages", ["id", "organizationId"]),
      auditEventsTable: mk("audit_events", ["id"]),
    },
  };
});

type Node = { __op: string; [k: string]: unknown };
// A column reference is one of the strings the fake tables actually define.
// Shape alone is not enough: a permission KEY such as "vehicle_request.approve"
// looks exactly like "table.column" and would otherwise be read as a join.
const COLUMNS = new Set<string>(
  Object.values(tables).flatMap((t) =>
    Object.entries(t)
      .filter(([k]) => k !== "__name")
      .map(([, v]) => v as string),
  ),
);
const isColumn = (v: unknown): v is string => typeof v === "string" && COLUMNS.has(v);

function evaluate(row: Record<string, unknown>, node: Node | undefined): boolean {
  if (!node) return true;
  switch (node.__op) {
    case "and":
      return (node.conds as Node[]).every((c) => evaluate(row, c));
    case "or":
      return (node.conds as Node[]).some((c) => evaluate(row, c));
    case "eq":
      return row[node.left as string] === node.right;
    case "isNull":
      return row[node.col as string] == null;
    case "gt":
      return (row[node.col as string] as Date) > (node.val as Date);
    default:
      return true;
  }
}

vi.mock("drizzle-orm", () => ({
  eq: (a: unknown, b: unknown) =>
    isColumn(a) && isColumn(b) ? { __op: "join", left: a, right: b } : { __op: "eq", left: a, right: b },
  and: (...conds: unknown[]) => ({ __op: "and", conds: conds.filter(Boolean) }),
  or: (...conds: unknown[]) => ({ __op: "or", conds: conds.filter(Boolean) }),
  isNull: (col: unknown) => ({ __op: "isNull", col }),
  gt: (col: unknown, val: unknown) => ({ __op: "gt", col, val }),
  asc: (col: unknown) => ({ __op: "asc", col }),
  inArray: (col: unknown, vals: unknown[]) => ({ __op: "inArray", col, vals }),
  sql: Object.assign(() => ({ __op: "sql" }), { raw: () => ({ __op: "sql" }) }),
}));

/** Flattens one table's row into qualified keys, e.g. "users.firstName". */
const qualify = (table: { __name: string }, row: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(row).map(([k, v]) => [`${table.__name}.${k}`, v]));

vi.mock("@workspace/db", () => ({
  ...tables,
  db: {
    selectDistinct: (projection: Record<string, string>) => ({
      from(base: { __name: string }) {
        let combined = (fixtures.rows[base.__name] ?? []).map((r) => qualify(base, r));
        const builder = {
          innerJoin(table: { __name: string }, on: Node) {
            const right = fixtures.rows[table.__name] ?? [];
            const next: Record<string, unknown>[] = [];
            for (const l of combined) {
              for (const r of right) {
                const merged = { ...l, ...qualify(table, r) };
                // A join condition compares two qualified columns.
                if (merged[on.left as string] === merged[on.right as string]) next.push(merged);
              }
            }
            combined = next;
            return builder;
          },
          where(cond: Node) {
            const kept = combined.filter((r) => evaluate(r, cond));
            const projected = kept.map((r) =>
              Object.fromEntries(Object.entries(projection).map(([alias, col]) => [alias, r[col]])),
            );
            // selectDistinct
            const seen = new Set<string>();
            const distinct = projected.filter((p) => {
              const key = JSON.stringify(p);
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            });
            return Promise.resolve(distinct);
          },
        };
        return builder;
      },
    }),
    select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
  },
}));

const { listApprovalCandidates } = await import("../lib/vehicleRequestStages");

const ORG = 10;
const OTHER_ORG = 20;
const APPROVE = "vehicle_request.approve";

/** Ids: permission 900 = the approve key; 901 = an unrelated key. */
function seed() {
  fixtures.rows = {
    users: [
      { id: 1, firstName: "Grace", lastName: "Hopper" },
      { id: 2, firstName: "Alan", lastName: "Turing" },
      { id: 3, firstName: "Ada", lastName: "Lovelace" },
      { id: 4, firstName: "Katherine", lastName: "Johnson" },
      { id: 5, firstName: "Bletchley", lastName: "Stranger" },
    ],
    organization_memberships: [
      { id: 101, organizationId: ORG, applicationUserId: 1, status: "active", expiresAt: null },
      { id: 102, organizationId: ORG, applicationUserId: 2, status: "active", expiresAt: null },
      { id: 103, organizationId: ORG, applicationUserId: 3, status: "revoked", expiresAt: null },
      { id: 104, organizationId: ORG, applicationUserId: 4, status: "active", expiresAt: new Date(Date.now() - 86_400_000) },
      { id: 201, organizationId: OTHER_ORG, applicationUserId: 5, status: "active", expiresAt: null },
    ],
    // 101 holds approve via a system role; 103 and 104 hold it too but are not
    // usable; 102 holds only an unrelated key; 201 holds it in the OTHER org.
    membership_roles: [
      { membershipId: 101, roleId: 50 },
      { membershipId: 102, roleId: 51 },
      { membershipId: 103, roleId: 50 },
      { membershipId: 104, roleId: 50 },
      { membershipId: 201, roleId: 50 },
    ],
    role_permissions: [
      { roleId: 50, permissionId: 900 },
      { roleId: 51, permissionId: 901 },
    ],
    permissions: [
      { id: 900, key: APPROVE },
      { id: 901, key: "asset_management.manage" },
    ],
  };
}

beforeEach(seed);

// This file's own fake, guarded. The permission key "vehicle_request.approve"
// has the same shape as a qualified column name, and an earlier version of the
// fake read it as a join condition — which silently dropped the permission
// filter and made every membership look like a candidate. A test fake that
// fails open is worse than no test at all, so it is checked here.
describe("the fake itself", () => {
  it("tells a column reference apart from a permission key", async () => {
    const drizzle = await import("drizzle-orm");
    expect(COLUMNS.has("permissions.key")).toBe(true);
    expect(COLUMNS.has("vehicle_request.approve")).toBe(false);
    const node = (drizzle as any).eq("permissions.key", "vehicle_request.approve");
    expect(node.__op).toBe("eq");
  });
});

describe("candidate query — who is returned", () => {
  it("returns an active member of this organization who holds vehicle_request.approve", async () => {
    const candidates = await listApprovalCandidates(ORG);
    expect(candidates).toEqual([{ membershipId: 101, firstName: "Grace", lastName: "Hopper" }]);
  });

  it("excludes a member who does not hold the permission", async () => {
    const candidates = await listApprovalCandidates(ORG);
    expect(candidates.map((c) => c.membershipId)).not.toContain(102);
  });

  it("excludes a revoked membership, however many permissions it holds", async () => {
    const candidates = await listApprovalCandidates(ORG);
    expect(candidates.map((c) => c.membershipId)).not.toContain(103);
  });

  it("excludes an expired membership — the canonical active predicate, not just status", async () => {
    // 104 is status "active" but past its expiry. A second reading of "active"
    // that checked only the status column would wrongly include it.
    const candidates = await listApprovalCandidates(ORG);
    expect(candidates.map((c) => c.membershipId)).not.toContain(104);
  });

  it("honours a membership whose expiry is still in the future", async () => {
    fixtures.rows.organization_memberships.push({
      id: 105,
      organizationId: ORG,
      applicationUserId: 2,
      status: "active",
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    fixtures.rows.membership_roles.push({ membershipId: 105, roleId: 50 });
    const candidates = await listApprovalCandidates(ORG);
    expect(candidates.map((c) => c.membershipId)).toContain(105);
  });

  it("counts a permission granted through an organization-defined custom role", async () => {
    // Resolution is by permission KEY through membership_roles ->
    // role_permissions -> permissions. A role this codebase has never heard of
    // grants exactly as much as a system template does.
    fixtures.rows.membership_roles.push({ membershipId: 102, roleId: 77 });
    fixtures.rows.role_permissions.push({ roleId: 77, permissionId: 900 });
    const candidates = await listApprovalCandidates(ORG);
    expect(candidates.map((c) => c.membershipId)).toContain(102);
  });

  it("returns one row per membership even when several roles grant the key", async () => {
    fixtures.rows.membership_roles.push({ membershipId: 101, roleId: 78 });
    fixtures.rows.role_permissions.push({ roleId: 78, permissionId: 900 });
    const candidates = await listApprovalCandidates(ORG);
    expect(candidates.filter((c) => c.membershipId === 101)).toHaveLength(1);
  });

  it("orders by name so the picker is stable", async () => {
    fixtures.rows.membership_roles.push({ membershipId: 102, roleId: 50 });
    const candidates = await listApprovalCandidates(ORG);
    expect(candidates.map((c) => c.lastName)).toEqual(["Hopper", "Turing"]);
  });
});

describe("candidate query — tenant isolation", () => {
  it("never returns a membership of another organization", async () => {
    const candidates = await listApprovalCandidates(ORG);
    expect(candidates.map((c) => c.membershipId)).not.toContain(201);
  });

  it("returns that organization's own candidate when asked for it, and only that one", async () => {
    const candidates = await listApprovalCandidates(OTHER_ORG);
    expect(candidates).toEqual([{ membershipId: 201, firstName: "Bletchley", lastName: "Stranger" }]);
  });

  it("returns nothing for an organization with no eligible members", async () => {
    await expect(listApprovalCandidates(999)).resolves.toEqual([]);
  });
});

describe("candidate query — response minimization", () => {
  it("exposes exactly membershipId, firstName and lastName — nothing else", async () => {
    const [candidate] = await listApprovalCandidates(ORG);
    // An exact key set, so a future field cannot be added without this failing.
    expect(Object.keys(candidate).sort()).toEqual(["firstName", "lastName", "membershipId"]);
  });

  it("carries no email, user id, role list or Primary HR flag", async () => {
    const [candidate] = await listApprovalCandidates(ORG);
    for (const leaked of ["email", "applicationUserId", "roles", "isPrimaryHr", "status", "joinedAt"]) {
      expect(candidate).not.toHaveProperty(leaked);
    }
  });
});

describe("candidate query — it grants nothing", () => {
  it("is read-only: no insert, update or delete is reachable from it", async () => {
    // The mocked db exposes only selectDistinct/select. A write would throw.
    await expect(listApprovalCandidates(ORG)).resolves.toBeInstanceOf(Array);
  });

  it("does not make a delegate a candidate — delegation is not permission possession", async () => {
    // WS-16 delegation transfers department-head AUTHORITY, never a permission.
    // A delegate who does not hold vehicle_request.approve in their own right
    // is not a valid `specific_membership` target, and no delegation table is
    // consulted here at all.
    fixtures.rows.organization_memberships.push({
      id: 106,
      organizationId: ORG,
      applicationUserId: 2,
      status: "active",
      expiresAt: null,
    });
    // 106 holds only the unrelated key, exactly as a delegate might.
    fixtures.rows.membership_roles.push({ membershipId: 106, roleId: 51 });
    const candidates = await listApprovalCandidates(ORG);
    expect(candidates.map((c) => c.membershipId)).not.toContain(106);
  });
});
