/**
 * VR-02A — Vehicle Request approval-stage configuration service.
 *
 * Exercises lib/vehicleRequestStages.ts against a mocked @workspace/db with
 * real field-based condition evaluation: organization scoping, per-resolver
 * config validation, the ordering guarantee, and the audit event every change
 * records. No real database connection is made.
 *
 * The audit-category assertion at the bottom is not decoration: unregistered
 * event-type prefixes fail closed to "security" and silently disappear from the
 * assets view, and `vehicle_request` is a different prefix from VR-01's
 * `vehicle`.
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
      stages: [] as Record<string, unknown>[],
      memberships: [] as Record<string, unknown>[],
      permissions: [] as Record<string, unknown>[],
      audits: [] as Record<string, unknown>[],
      inserts: [] as Record<string, unknown>[],
      updates: [] as Record<string, unknown>[],
      deletes: [] as unknown[],
      nextId: 500,
      failInsertWithUnique: false,
    },
    tables: {
      vehicleRequestApprovalStagesTable: mk("vehicle_request_approval_stages", [
        "id",
        "organizationId",
        "purpose",
        "stageOrder",
        "name",
        "resolverType",
        "resolverConfig",
        "createdByMembershipId",
        "updatedByMembershipId",
      ]),
      organizationMembershipsTable: mk("organization_memberships", ["id", "organizationId", "status"]),
      permissionsTable: mk("permissions", ["id", "key"]),
      auditEventsTable: mk("audit_events", ["id"]),
    },
  };
});

type Cond = { __op: string; field?: string; val?: unknown; conds?: Cond[] } | undefined;

function matches(row: Record<string, unknown>, cond: Cond): boolean {
  if (!cond) return true;
  if (cond.__op === "eq") return row[cond.field!] === cond.val;
  if (cond.__op === "and") return (cond.conds ?? []).every((c) => matches(row, c));
  return true;
}

class UniqueViolation extends Error {
  code = "23505";
}

vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: unknown) => ({ __op: "eq", field: String(col).split(".").pop(), val }),
  and: (...conds: Cond[]) => ({ __op: "and", conds: conds.filter(Boolean) }),
  asc: (col: string) => ({ __op: "asc", field: String(col).split(".").pop() }),
  sql: Object.assign(() => ({ __op: "sql" }), { raw: () => ({ __op: "sql" }) }),
}));

vi.mock("@workspace/db", () => ({
  ...tables,
  db: {
    select: () => ({
      from(table: { __name: string }) {
        const rows =
          table === tables.vehicleRequestApprovalStagesTable
            ? fixtures.stages
            : table === tables.organizationMembershipsTable
              ? fixtures.memberships
              : table === tables.permissionsTable
                ? fixtures.permissions
                : [];
        let filtered = rows;
        const builder = {
          where(cond: Cond) {
            filtered = rows.filter((r) => matches(r, cond));
            return builder;
          },
          orderBy: () => Promise.resolve([...filtered].sort((a, b) => Number(a["stageOrder"]) - Number(b["stageOrder"]))),
          limit: (n: number) => Promise.resolve(filtered.slice(0, n)),
          then: (resolve: (v: unknown) => void) => Promise.resolve(filtered).then(resolve),
        };
        return builder;
      },
    }),
    insert: (table: { __name: string }) => ({
      values: (v: Record<string, unknown>) => {
        if (table === tables.auditEventsTable) {
          fixtures.audits.push(v);
          return Promise.resolve();
        }
        if (fixtures.failInsertWithUnique) throw new UniqueViolation("duplicate key");
        const row = { id: ++fixtures.nextId, ...v };
        fixtures.inserts.push(v);
        fixtures.stages.push(row);
        return { returning: () => Promise.resolve([row]) };
      },
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => ({
        where(cond: Cond) {
          return {
            returning: () => {
              if (fixtures.failInsertWithUnique) throw new UniqueViolation("duplicate key");
              fixtures.updates.push(v);
              fixtures.stages = fixtures.stages.map((r) => (matches(r, cond) ? { ...r, ...v } : r));
              return Promise.resolve(fixtures.stages.filter((r) => matches(r, cond)));
            },
          };
        },
      }),
    }),
    delete: () => ({
      where(cond: Cond) {
        fixtures.deletes.push(cond);
        fixtures.stages = fixtures.stages.filter((r) => !matches(r, cond));
        return Promise.resolve();
      },
    }),
  },
}));

const {
  listStages,
  getStageById,
  countStages,
  createStage,
  updateStage,
  deleteStage,
  validateResolverConfig,
  VehicleRequestStageNotFoundError,
  InvalidVehicleRequestStageError,
  DuplicateVehicleRequestStageOrderError,
} = await import("../lib/vehicleRequestStages");
const { resolveAuditCategory } = await import("../lib/auditCategories");

const ORG = 10;
const OTHER_ORG = 20;
const actor = { actorApplicationUserId: 1, actorMembershipId: 5 };

beforeEach(() => {
  fixtures.stages = [
    { id: 1, organizationId: ORG, purpose: "vehicle_request", stageOrder: 1, name: "Department Head", resolverType: "department_head", resolverConfig: {} },
    { id: 2, organizationId: ORG, purpose: "vehicle_request", stageOrder: 2, name: "Transport Officer", resolverType: "permission_holder", resolverConfig: { permissionKey: "vehicle_request.approve" } },
    { id: 9, organizationId: OTHER_ORG, purpose: "vehicle_request", stageOrder: 1, name: "Other org", resolverType: "department_head", resolverConfig: {} },
  ];
  fixtures.memberships = [
    { id: 70, organizationId: ORG, status: "active" },
    { id: 71, organizationId: OTHER_ORG, status: "active" },
  ];
  fixtures.permissions = [{ id: 1, key: "vehicle_request.approve" }, { id: 2, key: "asset_management.manage" }];
  fixtures.audits = [];
  fixtures.inserts = [];
  fixtures.updates = [];
  fixtures.deletes = [];
  fixtures.failInsertWithUnique = false;
});

describe("reading the chain", () => {
  it("lists only this organization's stages, in ascending order", async () => {
    const stages = await listStages(ORG);
    expect(stages.map((s) => s.id)).toEqual([1, 2]);
  });

  it("treats another organization's stage as not found", async () => {
    expect(await getStageById(ORG, 9)).toBeNull();
    expect(await getStageById(OTHER_ORG, 9)).not.toBeNull();
  });

  it("counts the stages VR-02B will freeze onto a request", async () => {
    expect(await countStages(ORG)).toBe(2);
  });
});

describe("resolver configuration validation", () => {
  it("stores department_head with no configuration, and refuses any", async () => {
    expect(await validateResolverConfig(ORG, "department_head", null)).toEqual({});
    expect(await validateResolverConfig(ORG, "department_head", {})).toEqual({});
    await expect(validateResolverConfig(ORG, "department_head", { membershipId: 70 })).rejects.toThrow(InvalidVehicleRequestStageError);
  });

  it("requires a permissionKey that actually exists", async () => {
    expect(await validateResolverConfig(ORG, "permission_holder", { permissionKey: "vehicle_request.approve" })).toEqual({
      permissionKey: "vehicle_request.approve",
    });
    await expect(validateResolverConfig(ORG, "permission_holder", {})).rejects.toThrow(/requires a permissionKey/);
    // A typo would otherwise configure a stage that authorizes nobody, forever.
    await expect(validateResolverConfig(ORG, "permission_holder", { permissionKey: "vehicle_request.aprove" })).rejects.toThrow(
      /not a known permission/,
    );
  });

  it("requires a membershipId belonging to this organization", async () => {
    expect(await validateResolverConfig(ORG, "specific_membership", { membershipId: 70 })).toEqual({ membershipId: 70 });
    await expect(validateResolverConfig(ORG, "specific_membership", {})).rejects.toThrow(/requires a membershipId/);
    // Naming someone from another tenant would be a cross-tenant authority grant.
    await expect(validateResolverConfig(ORG, "specific_membership", { membershipId: 71 })).rejects.toThrow(
      /does not belong to this organization/,
    );
  });

  it("narrows what is stored to the resolver's own fields", async () => {
    const stored = await validateResolverConfig(ORG, "permission_holder", {
      permissionKey: "vehicle_request.approve",
      smuggled: "value",
    });
    expect(stored).toEqual({ permissionKey: "vehicle_request.approve" });
  });
});

describe("createStage", () => {
  it("creates a stage and records who did it", async () => {
    const stage = await createStage({ organizationId: ORG, stageOrder: 3, name: "  Finance   Sign-off ", resolverType: "department_head", ...actor });
    expect(stage.name).toBe("Finance Sign-off");
    expect(stage.purpose).toBe("vehicle_request");
    expect(fixtures.inserts[0]).toMatchObject({ organizationId: ORG, stageOrder: 3, createdByMembershipId: 5 });
    expect(fixtures.audits[0]).toMatchObject({
      eventType: "vehicle_request.stage_created",
      targetType: "vehicle_request_approval_stage",
    });
  });

  it("refuses a blank name and a non-positive order", async () => {
    await expect(createStage({ organizationId: ORG, stageOrder: 3, name: "   ", resolverType: "department_head", ...actor })).rejects.toThrow(
      InvalidVehicleRequestStageError,
    );
    await expect(createStage({ organizationId: ORG, stageOrder: 0, name: "Zero", resolverType: "department_head", ...actor })).rejects.toThrow(
      /positive integer/,
    );
    expect(fixtures.inserts).toHaveLength(0);
  });

  it("surfaces a duplicate position as a conflict, not a raw DB error", async () => {
    fixtures.failInsertWithUnique = true;
    await expect(createStage({ organizationId: ORG, stageOrder: 1, name: "Clash", resolverType: "department_head", ...actor })).rejects.toThrow(
      DuplicateVehicleRequestStageOrderError,
    );
    expect(fixtures.audits).toHaveLength(0);
  });

  it("refuses a malformed resolver before anything is written", async () => {
    await expect(
      createStage({ organizationId: ORG, stageOrder: 3, name: "Bad", resolverType: "permission_holder", resolverConfig: {}, ...actor }),
    ).rejects.toThrow(InvalidVehicleRequestStageError);
    expect(fixtures.inserts).toHaveLength(0);
    expect(fixtures.audits).toHaveLength(0);
  });
});

describe("updateStage", () => {
  it("updates only the supplied fields and audits before/after", async () => {
    await updateStage({ organizationId: ORG, stageId: 1, name: "HOD", ...actor });
    expect(fixtures.updates[0]).toMatchObject({ name: "HOD", updatedByMembershipId: 5 });
    expect(fixtures.audits[0]).toMatchObject({
      eventType: "vehicle_request.stage_updated",
      beforeState: { name: "Department Head" },
      afterState: { name: "HOD" },
    });
  });

  it("revalidates the config whenever the resolver type moves", async () => {
    // Switching type without a matching config would leave the old type's
    // config behind, authorizing nobody.
    await expect(updateStage({ organizationId: ORG, stageId: 1, resolverType: "permission_holder", ...actor })).rejects.toThrow(
      /requires a permissionKey/,
    );
    const updated = await updateStage({
      organizationId: ORG,
      stageId: 1,
      resolverType: "permission_holder",
      resolverConfig: { permissionKey: "asset_management.manage" },
      ...actor,
    });
    expect(updated.resolverType).toBe("permission_holder");
    expect(updated.resolverConfig).toEqual({ permissionKey: "asset_management.manage" });
  });

  it("treats another organization's stage as not found", async () => {
    await expect(updateStage({ organizationId: ORG, stageId: 9, name: "Hijack", ...actor })).rejects.toThrow(VehicleRequestStageNotFoundError);
    expect(fixtures.updates).toHaveLength(0);
  });

  it("surfaces a duplicate position on reorder as a conflict", async () => {
    fixtures.failInsertWithUnique = true;
    await expect(updateStage({ organizationId: ORG, stageId: 2, stageOrder: 1, ...actor })).rejects.toThrow(
      DuplicateVehicleRequestStageOrderError,
    );
  });
});

describe("deleteStage", () => {
  it("removes the configuration row and audits what was there", async () => {
    await deleteStage({ organizationId: ORG, stageId: 2, ...actor });
    expect(fixtures.stages.some((s) => s["id"] === 2)).toBe(false);
    expect(fixtures.audits[0]).toMatchObject({
      eventType: "vehicle_request.stage_deleted",
      beforeState: { stageOrder: 2, name: "Transport Officer" },
    });
  });

  it("treats another organization's stage as not found and deletes nothing", async () => {
    await expect(deleteStage({ organizationId: ORG, stageId: 9, ...actor })).rejects.toThrow(VehicleRequestStageNotFoundError);
    expect(fixtures.deletes).toHaveLength(0);
    expect(fixtures.stages.some((s) => s["id"] === 9)).toBe(true);
  });
});

describe("audit category registration", () => {
  it("files vehicle_request events under assets_inventory, not the security fallback", () => {
    // resolveAuditCategory splits on the FIRST dot, so `vehicle_request` is a
    // different prefix from VR-01's `vehicle` and needs its own registration.
    for (const eventType of [
      "vehicle_request.stage_created",
      "vehicle_request.stage_updated",
      "vehicle_request.stage_deleted",
    ]) {
      expect(resolveAuditCategory(eventType)).toBe("assets_inventory");
    }
    // VR-01's own prefix is unaffected.
    expect(resolveAuditCategory("vehicle.created")).toBe("assets_inventory");
    // And the fallback still exists for genuinely unknown prefixes.
    expect(resolveAuditCategory("not_a_registered_prefix.created")).toBe("security");
  });
});
