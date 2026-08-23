/**
 * Integration tests for Phase 3H, W116 — Physical Filing, Locations &
 * Movement: records_locations (lib/recordsLocations.ts,
 * routes/recordsLocations.ts) and personnel_file_volumes/
 * personnel_file_movements (lib/personnelFileCustody.ts,
 * routes/personnelFileCustody.ts). Exercises the real requireAuth/
 * requireMembership/requirePermission chain through supertest with a
 * real-where-filtering mocked @workspace/db (the Cond-matching style
 * established by learningEnrollments.test.ts/personnelFiles.test.ts).
 * Genuine concurrency (SELECT ... FOR UPDATE) is not exercised here — real
 * row-locking behavior is exercised only in live QA; `.for("update")` is a
 * chainable no-op passthrough. No real database connection is made.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

type Cond =
  | { __op: "eq"; field: string; val: unknown }
  | { __op: "isNull"; field: string }
  | { __op: "and"; conds: Cond[] }
  | undefined;

function matches(row: Record<string, unknown>, cond: Cond): boolean {
  if (!cond) return true;
  if (cond.__op === "eq") return row[cond.field] === cond.val;
  if (cond.__op === "isNull") return row[cond.field] == null;
  if (cond.__op === "and") return cond.conds.every((c) => matches(row, c));
  return true;
}

function colName(col: unknown): string {
  return typeof col === "string" ? col.split(".").pop()! : (col as string);
}

const {
  fixtures,
  usersTable,
  sessionsTable,
  organizationMembershipsTable,
  membershipRolesTable,
  rolePermissionsTable,
  permissionsTable,
  employeesTable,
  auditEventsTable,
  personnelFilesTable,
  recordsLocationsTable,
  personnelFileVolumesTable,
  personnelFileMovementsTable,
} = vi.hoisted(() => {
  function mockTable(name: string, columns: string[]) {
    const table: Record<string, string> & { __name: string } = { __name: name } as never;
    for (const col of columns) table[col] = `${name}.${col}`;
    return table;
  }
  return {
    fixtures: {
      sessionRows: [] as Record<string, unknown>[],
      membershipRows: [] as Record<string, unknown>[],
      membershipRoleRows: [] as { roleId: number }[],
      permissionRows: [] as { key: string }[],
      employeeRows: [] as Record<string, unknown>[],
      auditRows: [] as Record<string, unknown>[],
      personnelFileRows: [] as Record<string, unknown>[],
      recordsLocationRows: [] as Record<string, unknown>[],
      personnelFileVolumeRows: [] as Record<string, unknown>[],
      personnelFileMovementRows: [] as Record<string, unknown>[],
      idCounters: new Map<string, number>(),
    },
    usersTable: mockTable("users", ["id", "email"]),
    sessionsTable: mockTable("sessions", ["token", "userId", "expiresAt"]),
    organizationMembershipsTable: mockTable("organization_memberships", ["id", "applicationUserId", "organizationId", "status"]),
    membershipRolesTable: mockTable("membership_roles", ["membershipId", "roleId"]),
    rolePermissionsTable: mockTable("role_permissions", ["roleId", "permissionId"]),
    permissionsTable: mockTable("permissions", ["id", "key"]),
    employeesTable: mockTable("employees", ["id", "organizationId", "employmentStatus"]),
    auditEventsTable: mockTable("audit_events", []),
    personnelFilesTable: mockTable("personnel_files", [
      "id", "organizationId", "employeeId", "pifNumber", "allocationMethod", "allocatedByMembershipId",
      "currentLocationId", "currentCustodyState",
    ]),
    recordsLocationsTable: mockTable("records_locations", ["id", "organizationId", "parentId", "name", "description", "status"]),
    personnelFileVolumesTable: mockTable("personnel_file_volumes", [
      "id", "organizationId", "personnelFileId", "volumeNumber", "status", "currentLocationId", "currentCustodyState",
    ]),
    personnelFileMovementsTable: mockTable("personnel_file_movements", [
      "id", "organizationId", "personnelFileId", "volumeId", "eventType", "occurredAt", "actorMembershipId",
      "purpose", "destination", "expectedReturnDate", "notes",
    ]),
  };
});

function nextId(table: { __name: string }): number {
  const current = fixtures.idCounters.get(table.__name) ?? 0;
  const id = current + 1;
  fixtures.idCounters.set(table.__name, id);
  return id;
}

function rowsFor(table: { __name: string }): Record<string, unknown>[] {
  if (table === organizationMembershipsTable) return fixtures.membershipRows;
  if (table === membershipRolesTable) return fixtures.membershipRoleRows as never;
  if (table === rolePermissionsTable) return fixtures.permissionRows as never;
  if (table === employeesTable) return fixtures.employeeRows;
  if (table === auditEventsTable) return fixtures.auditRows;
  if (table === personnelFilesTable) return fixtures.personnelFileRows;
  if (table === recordsLocationsTable) return fixtures.recordsLocationRows;
  if (table === personnelFileVolumesTable) return fixtures.personnelFileVolumeRows;
  if (table === personnelFileMovementsTable) return fixtures.personnelFileMovementRows;
  return fixtures.sessionRows;
}

function setRowsFor(table: { __name: string }, rows: Record<string, unknown>[]): void {
  if (table === employeesTable) fixtures.employeeRows = rows;
  else if (table === auditEventsTable) fixtures.auditRows = rows;
  else if (table === personnelFilesTable) fixtures.personnelFileRows = rows;
  else if (table === recordsLocationsTable) fixtures.recordsLocationRows = rows;
  else if (table === personnelFileVolumesTable) fixtures.personnelFileVolumeRows = rows;
  else if (table === personnelFileMovementsTable) fixtures.personnelFileMovementRows = rows;
}

function makeQueryClient(): Record<string, unknown> {
  const client: Record<string, unknown> = {
    select: () => ({
      from(table: { __name: string }) {
        if (table === sessionsTable) {
          const rows = fixtures.sessionRows;
          const b = {
            innerJoin: () => b,
            where: () => b,
            limit: () => Promise.resolve(rows),
            then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => Promise.resolve(rows).then(resolve, reject),
          };
          return b;
        }
        if (table === membershipRolesTable || table === rolePermissionsTable) {
          const rows = rowsFor(table);
          const b = {
            innerJoin: () => b,
            where: () => b,
            limit: () => Promise.resolve(rows),
            orderBy: () => Promise.resolve(rows),
            then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => Promise.resolve(rows).then(resolve, reject),
          };
          return b;
        }

        const rows = rowsFor(table);
        const stage = (current: Record<string, unknown>[]): Record<string, unknown> & PromiseLike<Record<string, unknown>[]> => {
          const promise = Promise.resolve(current);
          return {
            where: (cond: Cond) => stage(current.filter((r) => matches(r, cond))),
            orderBy: () => stage(current),
            limit: (n: number) => stage(current.slice(0, n)),
            for: () => stage(current),
            then: promise.then.bind(promise),
          } as never;
        };
        return stage(rows);
      },
    }),
    insert: (table: { __name: string }) => ({
      values: (v: Record<string, unknown>) => {
        const defaults: Record<string, unknown> =
          table === recordsLocationsTable
            ? { status: "active", parentId: null, description: null }
            : table === personnelFileVolumesTable
              ? { status: "open", currentLocationId: null, currentCustodyState: "in_registry" }
              : table === personnelFileMovementsTable
                ? { occurredAt: new Date(), actorMembershipId: null, purpose: null, destination: null, expectedReturnDate: null, notes: null }
                : {};
        const row: Record<string, unknown> = { id: nextId(table), createdAt: new Date(), updatedAt: new Date(), ...defaults, ...v };
        const currentRows = rowsFor(table);
        if (table === personnelFileVolumesTable) {
          const dup = currentRows.some((r) => r.personnelFileId === row.personnelFileId && r.volumeNumber === row.volumeNumber);
          if (dup) throw Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" });
        }
        setRowsFor(table, [...currentRows, row]);
        const result = { returning: () => Promise.resolve([row]) };
        return { ...result, onConflictDoNothing: () => result };
      },
    }),
    update: (table: { __name: string }) => ({
      set: (patch: Record<string, unknown>) => ({
        where(cond: Cond) {
          const rows = rowsFor(table);
          const updated: Record<string, unknown>[] = [];
          const next = rows.map((r) => {
            if (matches(r, cond)) {
              const merged = { ...r, ...patch };
              updated.push(merged);
              return merged;
            }
            return r;
          });
          setRowsFor(table, next);
          return { returning: () => Promise.resolve(updated) };
        },
      }),
    }),
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(client),
  };
  return client;
}

const dbMock = makeQueryClient();

vi.mock("@workspace/db", () => ({
  usersTable,
  sessionsTable,
  organizationMembershipsTable,
  membershipRolesTable,
  rolePermissionsTable,
  permissionsTable,
  employeesTable,
  auditEventsTable,
  personnelFilesTable,
  recordsLocationsTable,
  personnelFileVolumesTable,
  personnelFileMovementsTable,
  db: dbMock,
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ __op: "eq", field: colName(col), val }),
  and: (...conds: Cond[]) => ({ __op: "and", conds: conds.filter(Boolean) }),
  or: () => undefined,
  isNull: (col: unknown) => ({ __op: "isNull", field: colName(col) }),
  ilike: () => undefined,
  inArray: () => undefined,
  gt: () => undefined,
  desc: () => undefined,
  count: () => "count",
}));

const { default: app } = await import("../app");

const ORG_ID = 10;
const OTHER_ORG_ID = 20;

function mockSession(userId = 1) {
  fixtures.sessionRows = [
    {
      session: { id: 1, token: "valid-token", userId, expiresAt: new Date(Date.now() + 100000) },
      user: { id: userId, email: "hr@example.com", firstName: "HR", lastName: "User", role: "employee", organizationId: ORG_ID, avatarUrl: null, jobTitle: null, department: null, phoneNumber: null, createdAt: new Date() },
    },
  ];
}

function mockActiveMembership(organizationId = ORG_ID, membershipId = 5) {
  fixtures.membershipRows = [
    { id: membershipId, applicationUserId: 1, organizationId, status: "active", expiresAt: null, createdAt: new Date(), updatedAt: new Date() },
  ];
}

function mockPermissions(permissionKeys: string[]) {
  fixtures.membershipRoleRows = [{ roleId: 1 }];
  fixtures.permissionRows = permissionKeys.map((key) => ({ key }));
}

function seedPersonnelFile(overrides: Record<string, unknown> = {}) {
  const file = {
    id: nextId(personnelFilesTable),
    organizationId: ORG_ID,
    employeeId: nextId(employeesTable),
    pifNumber: `PIF-${Math.random().toString(36).slice(2, 6)}`,
    allocationMethod: "generated",
    allocatedByMembershipId: null,
    currentLocationId: null,
    currentCustodyState: "in_registry",
    ...overrides,
  };
  fixtures.personnelFileRows = [...fixtures.personnelFileRows, file];
  return file;
}

const FULL_PERMS = ["personnel_file.read", "personnel_file.manage", "personnel_file.movement.write"];

beforeEach(() => {
  fixtures.sessionRows = [];
  fixtures.membershipRows = [];
  fixtures.membershipRoleRows = [];
  fixtures.permissionRows = [];
  fixtures.employeeRows = [];
  fixtures.auditRows = [];
  fixtures.personnelFileRows = [];
  fixtures.recordsLocationRows = [];
  fixtures.personnelFileVolumeRows = [];
  fixtures.personnelFileMovementRows = [];
  fixtures.idCounters = new Map();
  mockSession();
  mockActiveMembership();
});

describe("Records Locations", () => {
  it("returns 401 without auth", async () => {
    const res = await request(app).get(`/api/organizations/${ORG_ID}/records-locations`);
    expect(res.status).toBe(401);
  });

  it("returns 403 to create without personnel_file.manage", async () => {
    mockPermissions(["personnel_file.read"]);
    const res = await request(app).post(`/api/organizations/${ORG_ID}/records-locations`).set("Authorization", "Bearer valid-token").send({ name: "HR Office" });
    expect(res.status).toBe(403);
  });

  it("creates a root location", async () => {
    mockPermissions(FULL_PERMS);
    const res = await request(app).post(`/api/organizations/${ORG_ID}/records-locations`).set("Authorization", "Bearer valid-token").send({ name: "HR Office" });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("HR Office");
    expect(res.body.parentId).toBeNull();
    expect(res.body.status).toBe("active");
  });

  it("creates a nested location under a valid parent", async () => {
    mockPermissions(FULL_PERMS);
    const root = await request(app).post(`/api/organizations/${ORG_ID}/records-locations`).set("Authorization", "Bearer valid-token").send({ name: "HR Office" });
    const child = await request(app).post(`/api/organizations/${ORG_ID}/records-locations`).set("Authorization", "Bearer valid-token").send({ name: "Cabinet 2", parentId: root.body.id });
    expect(child.status).toBe(201);
    expect(child.body.parentId).toBe(root.body.id);
  });

  it("rejects a cross-organization parent", async () => {
    mockPermissions(FULL_PERMS);
    fixtures.recordsLocationRows = [{ id: 999, organizationId: OTHER_ORG_ID, parentId: null, name: "Acme Root", description: null, status: "active" }];
    const res = await request(app).post(`/api/organizations/${ORG_ID}/records-locations`).set("Authorization", "Bearer valid-token").send({ name: "Cabinet", parentId: 999 });
    expect(res.status).toBe(400);
  });

  it("rejects a cycle: A -> B -> C, then moving A under C", async () => {
    mockPermissions(FULL_PERMS);
    const a = await request(app).post(`/api/organizations/${ORG_ID}/records-locations`).set("Authorization", "Bearer valid-token").send({ name: "A" });
    const b = await request(app).post(`/api/organizations/${ORG_ID}/records-locations`).set("Authorization", "Bearer valid-token").send({ name: "B", parentId: a.body.id });
    const c = await request(app).post(`/api/organizations/${ORG_ID}/records-locations`).set("Authorization", "Bearer valid-token").send({ name: "C", parentId: b.body.id });

    const attempt = await request(app).patch(`/api/organizations/${ORG_ID}/records-locations/${a.body.id}`).set("Authorization", "Bearer valid-token").send({ parentId: c.body.id });
    expect(attempt.status).toBe(400);
  });

  it("rejects a self-parent", async () => {
    mockPermissions(FULL_PERMS);
    const a = await request(app).post(`/api/organizations/${ORG_ID}/records-locations`).set("Authorization", "Bearer valid-token").send({ name: "A" });
    const attempt = await request(app).patch(`/api/organizations/${ORG_ID}/records-locations/${a.body.id}`).set("Authorization", "Bearer valid-token").send({ parentId: a.body.id });
    expect(attempt.status).toBe(400);
  });

  it("retires and reactivates a location without deleting it", async () => {
    mockPermissions(FULL_PERMS);
    const a = await request(app).post(`/api/organizations/${ORG_ID}/records-locations`).set("Authorization", "Bearer valid-token").send({ name: "A" });
    const retired = await request(app).post(`/api/organizations/${ORG_ID}/records-locations/${a.body.id}/retire`).set("Authorization", "Bearer valid-token");
    expect(retired.status).toBe(200);
    expect(retired.body.status).toBe("retired");

    const list = await request(app).get(`/api/organizations/${ORG_ID}/records-locations`).set("Authorization", "Bearer valid-token");
    expect(list.body.some((l: { id: number }) => l.id === a.body.id)).toBe(true);

    const reactivated = await request(app).post(`/api/organizations/${ORG_ID}/records-locations/${a.body.id}/reactivate`).set("Authorization", "Bearer valid-token");
    expect(reactivated.status).toBe(200);
    expect(reactivated.body.status).toBe("active");
  });

  it("records audit events for create/update/retire", async () => {
    mockPermissions(FULL_PERMS);
    const a = await request(app).post(`/api/organizations/${ORG_ID}/records-locations`).set("Authorization", "Bearer valid-token").send({ name: "A" });
    await request(app).patch(`/api/organizations/${ORG_ID}/records-locations/${a.body.id}`).set("Authorization", "Bearer valid-token").send({ name: "A Renamed" });
    await request(app).post(`/api/organizations/${ORG_ID}/records-locations/${a.body.id}/retire`).set("Authorization", "Bearer valid-token");

    expect(fixtures.auditRows.some((r) => r.eventType === "records_location.created")).toBe(true);
    expect(fixtures.auditRows.some((r) => r.eventType === "records_location.updated")).toBe(true);
    expect(fixtures.auditRows.some((r) => r.eventType === "records_location.retired")).toBe(true);
  });
});

describe("Personnel File Volumes", () => {
  it("creates sequential volumes", async () => {
    mockPermissions(FULL_PERMS);
    const file = seedPersonnelFile();
    const v1 = await request(app).post(`/api/organizations/${ORG_ID}/personnel-files/${file.id}/volumes`).set("Authorization", "Bearer valid-token");
    const v2 = await request(app).post(`/api/organizations/${ORG_ID}/personnel-files/${file.id}/volumes`).set("Authorization", "Bearer valid-token");
    expect(v1.body.volumeNumber).toBe(1);
    expect(v2.body.volumeNumber).toBe(2);

    const list = await request(app).get(`/api/organizations/${ORG_ID}/personnel-files/${file.id}/volumes`).set("Authorization", "Bearer valid-token");
    expect(list.body.map((v: { volumeNumber: number }) => v.volumeNumber)).toEqual([1, 2]);
    expect(list.body.every((v: { personnelFileId: number }) => v.personnelFileId === file.id)).toBe(true);
  });

  it("returns 403 to create a volume without personnel_file.manage", async () => {
    mockPermissions(["personnel_file.read"]);
    const file = seedPersonnelFile();
    const res = await request(app).post(`/api/organizations/${ORG_ID}/personnel-files/${file.id}/volumes`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  it("records a personnel_file_volume.created audit event", async () => {
    mockPermissions(FULL_PERMS);
    const file = seedPersonnelFile();
    await request(app).post(`/api/organizations/${ORG_ID}/personnel-files/${file.id}/volumes`).set("Authorization", "Bearer valid-token");
    expect(fixtures.auditRows.some((r) => r.eventType === "personnel_file_volume.created")).toBe(true);
  });
});

describe("Personnel File Custody: checkout / return / missing / recover", () => {
  it("returns 403 to check out without personnel_file.movement.write", async () => {
    mockPermissions(["personnel_file.read", "personnel_file.manage"]);
    const file = seedPersonnelFile();
    const res = await request(app).post(`/api/organizations/${ORG_ID}/personnel-files/${file.id}/checkout`).set("Authorization", "Bearer valid-token").send({ destination: "Jane Doe (HR)" });
    expect(res.status).toBe(403);
  });

  it("checks out a file from in_registry", async () => {
    mockPermissions(FULL_PERMS);
    const file = seedPersonnelFile();
    const res = await request(app).post(`/api/organizations/${ORG_ID}/personnel-files/${file.id}/checkout`).set("Authorization", "Bearer valid-token").send({ destination: "Jane Doe (HR)", purpose: "Audit" });
    expect(res.status).toBe(201);
    expect(res.body.eventType).toBe("checked_out");
    expect(res.body.destination).toBe("Jane Doe (HR)");

    const custody = await request(app).get(`/api/organizations/${ORG_ID}/personnel-files/${file.id}/custody`).set("Authorization", "Bearer valid-token");
    expect(custody.body.currentCustodyState).toBe("checked_out");
    expect(custody.body.currentLocationId).toBeNull();
  });

  it("rejects a second checkout while already checked out (409)", async () => {
    mockPermissions(FULL_PERMS);
    const file = seedPersonnelFile();
    await request(app).post(`/api/organizations/${ORG_ID}/personnel-files/${file.id}/checkout`).set("Authorization", "Bearer valid-token").send({ destination: "A" });
    const second = await request(app).post(`/api/organizations/${ORG_ID}/personnel-files/${file.id}/checkout`).set("Authorization", "Bearer valid-token").send({ destination: "B" });
    expect(second.status).toBe(409);
  });

  it("returns a checked-out file into a location", async () => {
    mockPermissions(FULL_PERMS);
    const file = seedPersonnelFile();
    const location = await request(app).post(`/api/organizations/${ORG_ID}/records-locations`).set("Authorization", "Bearer valid-token").send({ name: "Shelf 1" });
    await request(app).post(`/api/organizations/${ORG_ID}/personnel-files/${file.id}/checkout`).set("Authorization", "Bearer valid-token").send({ destination: "A" });

    const returned = await request(app).post(`/api/organizations/${ORG_ID}/personnel-files/${file.id}/return`).set("Authorization", "Bearer valid-token").send({ locationId: location.body.id });
    expect(returned.status).toBe(201);
    expect(returned.body.eventType).toBe("returned");

    const custody = await request(app).get(`/api/organizations/${ORG_ID}/personnel-files/${file.id}/custody`).set("Authorization", "Bearer valid-token");
    expect(custody.body.currentCustodyState).toBe("in_registry");
    expect(custody.body.currentLocationId).toBe(location.body.id);
  });

  it("rejects returning a file that is already in_registry (409)", async () => {
    mockPermissions(FULL_PERMS);
    const file = seedPersonnelFile();
    const res = await request(app).post(`/api/organizations/${ORG_ID}/personnel-files/${file.id}/return`).set("Authorization", "Bearer valid-token").send({});
    expect(res.status).toBe(409);
  });

  it("rejects a retired location on return (400)", async () => {
    mockPermissions(FULL_PERMS);
    const file = seedPersonnelFile();
    const location = await request(app).post(`/api/organizations/${ORG_ID}/records-locations`).set("Authorization", "Bearer valid-token").send({ name: "Shelf 1" });
    await request(app).post(`/api/organizations/${ORG_ID}/records-locations/${location.body.id}/retire`).set("Authorization", "Bearer valid-token");
    await request(app).post(`/api/organizations/${ORG_ID}/personnel-files/${file.id}/checkout`).set("Authorization", "Bearer valid-token").send({ destination: "A" });

    const returned = await request(app).post(`/api/organizations/${ORG_ID}/personnel-files/${file.id}/return`).set("Authorization", "Bearer valid-token").send({ locationId: location.body.id });
    expect(returned.status).toBe(400);
  });

  it("marks a checked-out file missing, requiring a reason", async () => {
    mockPermissions(FULL_PERMS);
    const file = seedPersonnelFile();
    await request(app).post(`/api/organizations/${ORG_ID}/personnel-files/${file.id}/checkout`).set("Authorization", "Bearer valid-token").send({ destination: "A" });

    const noReason = await request(app).post(`/api/organizations/${ORG_ID}/personnel-files/${file.id}/mark-missing`).set("Authorization", "Bearer valid-token").send({});
    expect(noReason.status).toBe(400);

    const missing = await request(app).post(`/api/organizations/${ORG_ID}/personnel-files/${file.id}/mark-missing`).set("Authorization", "Bearer valid-token").send({ notes: "Not found during audit" });
    expect(missing.status).toBe(201);

    const custody = await request(app).get(`/api/organizations/${ORG_ID}/personnel-files/${file.id}/custody`).set("Authorization", "Bearer valid-token");
    expect(custody.body.currentCustodyState).toBe("missing");
  });

  it("rejects marking an in_registry file missing (409)", async () => {
    mockPermissions(FULL_PERMS);
    const file = seedPersonnelFile();
    const res = await request(app).post(`/api/organizations/${ORG_ID}/personnel-files/${file.id}/mark-missing`).set("Authorization", "Bearer valid-token").send({ notes: "x" });
    expect(res.status).toBe(409);
  });

  it("preserves the full checkout->missing history and the original holder when marked missing", async () => {
    mockPermissions(FULL_PERMS);
    const file = seedPersonnelFile();
    await request(app).post(`/api/organizations/${ORG_ID}/personnel-files/${file.id}/checkout`).set("Authorization", "Bearer valid-token").send({ destination: "Jane Doe" });
    await request(app).post(`/api/organizations/${ORG_ID}/personnel-files/${file.id}/mark-missing`).set("Authorization", "Bearer valid-token").send({ notes: "Lost" });

    const history = await request(app).get(`/api/organizations/${ORG_ID}/personnel-files/${file.id}/movements`).set("Authorization", "Bearer valid-token");
    const eventTypes = history.body.map((m: { eventType: string }) => m.eventType);
    expect(eventTypes).toContain("checked_out");
    expect(eventTypes).toContain("marked_missing");
    const checkoutEvent = history.body.find((m: { eventType: string }) => m.eventType === "checked_out");
    expect(checkoutEvent.destination).toBe("Jane Doe");
  });

  it("recovers a missing file into a location", async () => {
    mockPermissions(FULL_PERMS);
    const file = seedPersonnelFile();
    const location = await request(app).post(`/api/organizations/${ORG_ID}/records-locations`).set("Authorization", "Bearer valid-token").send({ name: "Shelf 2" });
    await request(app).post(`/api/organizations/${ORG_ID}/personnel-files/${file.id}/checkout`).set("Authorization", "Bearer valid-token").send({ destination: "A" });
    await request(app).post(`/api/organizations/${ORG_ID}/personnel-files/${file.id}/mark-missing`).set("Authorization", "Bearer valid-token").send({ notes: "Lost" });

    const recovered = await request(app).post(`/api/organizations/${ORG_ID}/personnel-files/${file.id}/recover`).set("Authorization", "Bearer valid-token").send({ locationId: location.body.id });
    expect(recovered.status).toBe(201);
    expect(recovered.body.eventType).toBe("recovered");

    const custody = await request(app).get(`/api/organizations/${ORG_ID}/personnel-files/${file.id}/custody`).set("Authorization", "Bearer valid-token");
    expect(custody.body.currentCustodyState).toBe("in_registry");
    expect(custody.body.currentLocationId).toBe(location.body.id);
  });

  it("rejects recovering a file that is not missing (409)", async () => {
    mockPermissions(FULL_PERMS);
    const file = seedPersonnelFile();
    const res = await request(app).post(`/api/organizations/${ORG_ID}/personnel-files/${file.id}/recover`).set("Authorization", "Bearer valid-token").send({});
    expect(res.status).toBe(409);
  });

  it("allows returning a file directly from missing (found and brought back by the holder)", async () => {
    mockPermissions(FULL_PERMS);
    const file = seedPersonnelFile();
    await request(app).post(`/api/organizations/${ORG_ID}/personnel-files/${file.id}/checkout`).set("Authorization", "Bearer valid-token").send({ destination: "A" });
    await request(app).post(`/api/organizations/${ORG_ID}/personnel-files/${file.id}/mark-missing`).set("Authorization", "Bearer valid-token").send({ notes: "Lost" });

    const returned = await request(app).post(`/api/organizations/${ORG_ID}/personnel-files/${file.id}/return`).set("Authorization", "Bearer valid-token").send({});
    expect(returned.status).toBe(201);
    expect(returned.body.eventType).toBe("returned");
  });

  it("derives overdue live from an unresolved checked_out event's expectedReturnDate — never stored", async () => {
    mockPermissions(FULL_PERMS);
    const filePastDue = seedPersonnelFile();
    await request(app)
      .post(`/api/organizations/${ORG_ID}/personnel-files/${filePastDue.id}/checkout`)
      .set("Authorization", "Bearer valid-token")
      .send({ destination: "A", expectedReturnDate: "2020-01-01T00:00:00.000Z" });
    const pastDueCustody = await request(app).get(`/api/organizations/${ORG_ID}/personnel-files/${filePastDue.id}/custody`).set("Authorization", "Bearer valid-token");
    expect(pastDueCustody.body.overdue).toBe(true);

    const fileNotDue = seedPersonnelFile();
    await request(app)
      .post(`/api/organizations/${ORG_ID}/personnel-files/${fileNotDue.id}/checkout`)
      .set("Authorization", "Bearer valid-token")
      .send({ destination: "A", expectedReturnDate: "2099-01-01T00:00:00.000Z" });
    const notDueCustody = await request(app).get(`/api/organizations/${ORG_ID}/personnel-files/${fileNotDue.id}/custody`).set("Authorization", "Bearer valid-token");
    expect(notDueCustody.body.overdue).toBe(false);

    const fileInRegistry = seedPersonnelFile();
    const registryCustody = await request(app).get(`/api/organizations/${ORG_ID}/personnel-files/${fileInRegistry.id}/custody`).set("Authorization", "Bearer valid-token");
    expect(registryCustody.body.overdue).toBe(false);
  });

  it("rejects cross-organization personnel file ids (404)", async () => {
    mockPermissions(FULL_PERMS);
    fixtures.personnelFileRows = [{ id: 999, organizationId: OTHER_ORG_ID, employeeId: 1, pifNumber: "PIF-X", allocationMethod: "generated", allocatedByMembershipId: null, currentLocationId: null, currentCustodyState: "in_registry" }];
    const res = await request(app).post(`/api/organizations/${ORG_ID}/personnel-files/999/checkout`).set("Authorization", "Bearer valid-token").send({ destination: "A" });
    expect(res.status).toBe(404);
  });

  it("records checked_out/missing/recovered/returned audit events (across two full cycles), and stays silent on GET", async () => {
    mockPermissions(FULL_PERMS);
    const file = seedPersonnelFile();
    fixtures.auditRows = [];
    // Cycle 1: checkout -> missing -> recovered (recover already lands back in_registry).
    await request(app).post(`/api/organizations/${ORG_ID}/personnel-files/${file.id}/checkout`).set("Authorization", "Bearer valid-token").send({ destination: "A" });
    await request(app).post(`/api/organizations/${ORG_ID}/personnel-files/${file.id}/mark-missing`).set("Authorization", "Bearer valid-token").send({ notes: "x" });
    await request(app).post(`/api/organizations/${ORG_ID}/personnel-files/${file.id}/recover`).set("Authorization", "Bearer valid-token").send({});
    // Cycle 2: a fresh checkout from the now-in_registry state, then an ordinary return.
    await request(app).post(`/api/organizations/${ORG_ID}/personnel-files/${file.id}/checkout`).set("Authorization", "Bearer valid-token").send({ destination: "B" });
    await request(app).post(`/api/organizations/${ORG_ID}/personnel-files/${file.id}/return`).set("Authorization", "Bearer valid-token").send({});

    const auditCountAfterWrites = fixtures.auditRows.length;
    expect(fixtures.auditRows.map((r) => r.eventType)).toEqual([
      "personnel_file.checked_out",
      "personnel_file.missing",
      "personnel_file.recovered",
      "personnel_file.checked_out",
      "personnel_file.returned",
    ]);

    await request(app).get(`/api/organizations/${ORG_ID}/personnel-files/${file.id}/custody`).set("Authorization", "Bearer valid-token");
    await request(app).get(`/api/organizations/${ORG_ID}/personnel-files/${file.id}/movements`).set("Authorization", "Bearer valid-token");
    expect(fixtures.auditRows.length).toBe(auditCountAfterWrites);
  });
});
