/**
 * VR-01 — vehicle register service. Exercises lib/vehicles.ts against a mocked
 * @workspace/db with real field-based condition evaluation: organization
 * scoping, registration-number normalization and uniqueness, cross-organization
 * references, the in_use guard the register may never override, and the audit
 * event every change records. No real database connection is made.
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
      vehicles: [] as Record<string, unknown>[],
      branches: [] as Record<string, unknown>[],
      employees: [] as Record<string, unknown>[],
      audits: [] as Record<string, unknown>[],
      inserts: [] as Record<string, unknown>[],
      updates: [] as Record<string, unknown>[],
      nextId: 100,
      failInsertWithUnique: false,
    },
    tables: {
      vehiclesTable: mk("vehicles", [
        "id",
        "organizationId",
        "registrationNumber",
        "make",
        "model",
        "description",
        "defaultDriverEmployeeId",
        "branchId",
        "status",
        "notes",
        "createdByMembershipId",
        "updatedByMembershipId",
      ]),
      branchesTable: mk("branches", ["id", "organizationId"]),
      employeesTable: mk("employees", ["id", "organizationId"]),
      auditEventsTable: mk("audit_events", ["id"]),
    },
  };
});

type Cond =
  | { __op: "eq"; field: string; val: unknown }
  | { __op: "and"; conds: Cond[] }
  | { __op: "or"; conds: Cond[] }
  | { __op: "ilike"; field: string; val: string }
  | undefined;

function matches(row: Record<string, unknown>, cond: Cond): boolean {
  if (!cond) return true;
  if (cond.__op === "eq") return row[cond.field] === cond.val;
  if (cond.__op === "and") return cond.conds.every((c) => matches(row, c));
  if (cond.__op === "or") return cond.conds.some((c) => matches(row, c));
  if (cond.__op === "ilike") {
    const needle = cond.val.replace(/%/g, "").toLowerCase();
    return String(row[cond.field] ?? "").toLowerCase().includes(needle);
  }
  return true;
}

class UniqueViolation extends Error {
  code = "23505";
}

vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: unknown) => ({ __op: "eq", field: col.split(".").pop(), val }),
  and: (...conds: Cond[]) => ({ __op: "and", conds: conds.filter(Boolean) }),
  or: (...conds: Cond[]) => ({ __op: "or", conds: conds.filter(Boolean) }),
  ilike: (col: string, val: string) => ({ __op: "ilike", field: col.split(".").pop(), val }),
}));

vi.mock("@workspace/db", () => ({
  ...tables,
  db: {
    select: () => ({
      from(table: { __name: string }) {
        const rows =
          table === tables.vehiclesTable
            ? fixtures.vehicles
            : table === tables.branchesTable
              ? fixtures.branches
              : table === tables.employeesTable
                ? fixtures.employees
                : [];
        let filtered = rows;
        const builder = {
          where(cond: Cond) {
            filtered = rows.filter((r) => matches(r, cond));
            return builder;
          },
          orderBy: () => Promise.resolve(filtered),
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
        if (fixtures.failInsertWithUnique) throw new UniqueViolation("duplicate key value violates unique constraint");
        const row = { id: ++fixtures.nextId, ...v };
        fixtures.inserts.push(v);
        fixtures.vehicles.push(row);
        return { returning: () => Promise.resolve([row]) };
      },
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => ({
        where(cond: Cond) {
          return {
            returning: () => {
              if (fixtures.failInsertWithUnique) throw new UniqueViolation("duplicate key value violates unique constraint");
              fixtures.updates.push(v);
              fixtures.vehicles = fixtures.vehicles.map((r) => (matches(r, cond) ? { ...r, ...v } : r));
              return Promise.resolve(fixtures.vehicles.filter((r) => matches(r, cond)));
            },
          };
        },
      }),
    }),
  },
}));

const {
  listVehicles,
  getVehicleById,
  createVehicle,
  updateVehicle,
  normalizeRegistrationNumber,
  VehicleNotFoundError,
  InvalidVehicleError,
  DuplicateVehicleRegistrationError,
} = await import("../lib/vehicles");
const { CrossOrganizationReferenceError } = await import("../lib/orgScopedRefs");

const ORG = 10;
const OTHER_ORG = 20;
const actor = { actorApplicationUserId: 1, actorMembershipId: 5 };

beforeEach(() => {
  fixtures.vehicles = [
    { id: 1, organizationId: ORG, registrationNumber: "GR 1234-20", make: "Toyota", model: "Hiace", status: "available", notes: null },
    { id: 2, organizationId: ORG, registrationNumber: "GT 5678-21", make: "Nissan", model: "Urvan", status: "maintenance", notes: null },
    { id: 3, organizationId: ORG, registrationNumber: "GW 9999-22", make: "Toyota", model: "Corolla", status: "in_use", notes: null },
    { id: 9, organizationId: OTHER_ORG, registrationNumber: "XX 0000-00", make: "Other", model: "Org", status: "available", notes: null },
  ];
  fixtures.branches = [{ id: 50, organizationId: ORG }, { id: 51, organizationId: OTHER_ORG }];
  fixtures.employees = [{ id: 70, organizationId: ORG }, { id: 71, organizationId: OTHER_ORG }];
  fixtures.audits = [];
  fixtures.inserts = [];
  fixtures.updates = [];
  fixtures.failInsertWithUnique = false;
});

describe("normalizeRegistrationNumber", () => {
  it("trims, collapses spacing and upper-cases so one vehicle cannot be registered twice", () => {
    expect(normalizeRegistrationNumber("  gr   1234-20 ")).toBe("GR 1234-20");
  });

  it("refuses an empty or over-long registration number", () => {
    expect(() => normalizeRegistrationNumber("   ")).toThrow(InvalidVehicleError);
    expect(() => normalizeRegistrationNumber("G".repeat(33))).toThrow(InvalidVehicleError);
  });
});

describe("listVehicles / getVehicleById", () => {
  it("returns only the caller's organization", async () => {
    const list = await listVehicles(ORG);
    expect(list.map((v) => v.id).sort()).toEqual([1, 2, 3]);
  });

  it("filters by status", async () => {
    const list = await listVehicles(ORG, { status: "maintenance" });
    expect(list.map((v) => v.registrationNumber)).toEqual(["GT 5678-21"]);
  });

  it("searches registration, make and model", async () => {
    expect((await listVehicles(ORG, { search: "toyota" })).map((v) => v.id).sort()).toEqual([1, 3]);
    expect((await listVehicles(ORG, { search: "urvan" })).map((v) => v.id)).toEqual([2]);
    expect((await listVehicles(ORG, { search: "5678" })).map((v) => v.id)).toEqual([2]);
  });

  it("does not find another organization's vehicle by id", async () => {
    expect(await getVehicleById(ORG, 9)).toBeNull();
    expect(await getVehicleById(OTHER_ORG, 9)).not.toBeNull();
  });
});

describe("createVehicle", () => {
  it("stores the normalized registration number, starts available, and audits", async () => {
    const vehicle = await createVehicle({
      organizationId: ORG,
      registrationNumber: " gw 4321-23 ",
      make: "  Ford  ",
      model: "",
      ...actor,
    });
    expect(vehicle.registrationNumber).toBe("GW 4321-23");
    expect(fixtures.inserts[0]).toMatchObject({ organizationId: ORG, status: "available", make: "Ford", model: null, createdByMembershipId: 5 });
    expect(fixtures.audits).toHaveLength(1);
    expect(fixtures.audits[0]).toMatchObject({
      eventType: "vehicle.created",
      targetType: "vehicle",
      organizationId: ORG,
      actorMembershipId: 5,
      category: "assets_inventory",
    });
  });

  it("surfaces a duplicate registration number as a conflict, not a raw DB error", async () => {
    fixtures.failInsertWithUnique = true;
    await expect(createVehicle({ organizationId: ORG, registrationNumber: "GR 1234-20", ...actor })).rejects.toThrow(
      DuplicateVehicleRegistrationError,
    );
    expect(fixtures.audits).toHaveLength(0);
  });

  it("refuses a branch or default driver from another organization", async () => {
    await expect(createVehicle({ organizationId: ORG, registrationNumber: "NEW 1", branchId: 51, ...actor })).rejects.toThrow(
      CrossOrganizationReferenceError,
    );
    await expect(
      createVehicle({ organizationId: ORG, registrationNumber: "NEW 2", defaultDriverEmployeeId: 71, ...actor }),
    ).rejects.toThrow(CrossOrganizationReferenceError);
    expect(fixtures.inserts).toHaveLength(0);
  });
});

describe("updateVehicle", () => {
  it("updates only the supplied fields and records who changed them", async () => {
    await updateVehicle({ organizationId: ORG, vehicleId: 1, model: "Hiace GL", ...actor });
    expect(fixtures.updates[0]).toEqual({ model: "Hiace GL", updatedByMembershipId: 5 });
    expect(fixtures.audits[0]).toMatchObject({ eventType: "vehicle.updated", metadata: { changedFields: ["model"] } });
  });

  it("audits a status change distinctly from an ordinary edit", async () => {
    await updateVehicle({ organizationId: ORG, vehicleId: 1, status: "inactive", ...actor });
    expect(fixtures.audits[0]).toMatchObject({
      eventType: "vehicle.status_changed",
      beforeState: { status: "available" },
      afterState: { status: "inactive" },
    });
  });

  it("refuses a status the register may not set", async () => {
    await expect(
      updateVehicle({ organizationId: ORG, vehicleId: 1, status: "in_use" as never, ...actor }),
    ).rejects.toThrow(InvalidVehicleError);
    expect(fixtures.updates).toHaveLength(0);
  });

  it("refuses to change the status of a vehicle that is currently out", async () => {
    await expect(updateVehicle({ organizationId: ORG, vehicleId: 3, status: "available", ...actor })).rejects.toThrow(
      /currently out/i,
    );
    expect(fixtures.updates).toHaveLength(0);
  });

  it("still allows editing the details of a vehicle that is out", async () => {
    await updateVehicle({ organizationId: ORG, vehicleId: 3, notes: "Serviced last month", ...actor });
    expect(fixtures.updates[0]).toMatchObject({ notes: "Serviced last month" });
  });

  it("treats another organization's vehicle as not found", async () => {
    await expect(updateVehicle({ organizationId: ORG, vehicleId: 9, model: "Hijack", ...actor })).rejects.toThrow(
      VehicleNotFoundError,
    );
    expect(fixtures.updates).toHaveLength(0);
  });

  it("surfaces a duplicate registration number on rename as a conflict", async () => {
    fixtures.failInsertWithUnique = true;
    await expect(updateVehicle({ organizationId: ORG, vehicleId: 1, registrationNumber: "GT 5678-21", ...actor })).rejects.toThrow(
      DuplicateVehicleRegistrationError,
    );
  });
});
