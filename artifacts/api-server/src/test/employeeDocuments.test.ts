/**
 * Integration tests for Employee Documents (Phase 2A, W23), exercising the
 * real requireAuth/requireMembership/requirePermission chain and route
 * handlers through supertest, mirroring employees.test.ts's harness shape.
 * @workspace/db and ../lib/fileStorage are mocked — no real database
 * connection or disk I/O is made.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

const {
  fixtures,
  usersTable,
  sessionsTable,
  organizationMembershipsTable,
  membershipRolesTable,
  rolePermissionsTable,
  permissionsTable,
  employeesTable,
  employeeUserLinksTable,
  employeeDocumentsTable,
  auditEventsTable,
} = vi.hoisted(() => {
  return {
    fixtures: {
      sessionRows: [] as unknown[],
      membershipRows: [] as unknown[],
      membershipRoleRows: [] as { roleId: number }[],
      permissionRows: [] as { key: string }[],
      employeeRows: [] as { id: number; organizationId: number; firstName: string; lastName: string }[],
      // WWM Employee Access Remediation (2026-09-07): employee_user_links rows
      // so the route's own-record resolution (resolveOwnEmployeeId) can be
      // exercised — an empty list means "the caller is not this employee".
      linkRows: [] as { employeeId: number; applicationUserId: number }[],
      documentRows: [] as Record<string, unknown>[],
      inserted: [] as { table: string; values: unknown }[],
      deleted: [] as { table: string }[],
      idCounters: new Map<string, number>(),
    },
    usersTable: { __name: "users" },
    sessionsTable: { __name: "sessions" },
    organizationMembershipsTable: { __name: "organization_memberships" },
    membershipRolesTable: { __name: "membership_roles" },
    rolePermissionsTable: { __name: "role_permissions" },
    permissionsTable: { __name: "permissions" },
    employeesTable: { __name: "employees" },
    employeeUserLinksTable: { __name: "employee_user_links" },
    employeeDocumentsTable: { __name: "employee_documents" },
    auditEventsTable: { __name: "audit_events" },
  };
});

function nextId(table: { __name: string }): number {
  const current = fixtures.idCounters.get(table.__name) ?? 0;
  const id = current + 1;
  fixtures.idCounters.set(table.__name, id);
  return id;
}

vi.mock("@workspace/db", () => ({
  usersTable,
  sessionsTable,
  organizationMembershipsTable,
  membershipRolesTable,
  rolePermissionsTable,
  permissionsTable,
  employeesTable,
  employeeUserLinksTable,
  employeeDocumentsTable,
  auditEventsTable,
  db: {
    select: () => ({
      from(table: { __name: string }) {
        let rows: unknown[] = [];
        if (table === organizationMembershipsTable) rows = fixtures.membershipRows;
        else if (table === membershipRolesTable) rows = fixtures.membershipRoleRows;
        else if (table === rolePermissionsTable) rows = fixtures.permissionRows;
        else if (table === employeesTable) rows = fixtures.employeeRows;
        else if (table === employeeUserLinksTable) rows = fixtures.linkRows;
        else if (table === employeeDocumentsTable) rows = fixtures.documentRows;
        else rows = fixtures.sessionRows;

        const builder = {
          innerJoin: () => builder,
          where: () => builder,
          limit: () => Promise.resolve(rows),
          orderBy: () => Promise.resolve(rows),
          then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
            Promise.resolve(rows).then(resolve, reject),
        };
        return builder;
      },
    }),
    insert: (table: { __name: string }) => ({
      values: (v: Record<string, unknown>) => {
        fixtures.inserted.push({ table: table.__name, values: v });
        return { returning: () => Promise.resolve([{ id: nextId(table), createdAt: new Date(), ...v }]) };
      },
    }),
    delete: (table: { __name: string }) => ({
      where: () => {
        fixtures.deleted.push({ table: table.__name });
        return Promise.resolve(undefined);
      },
    }),
  },
}));

vi.mock("../lib/fileStorage", () => ({
  writeOrgFile: vi.fn(async () => "documents/mock-key.pdf"),
  readOrgFile: vi.fn(async () => Buffer.from("")),
  deleteOrgFile: vi.fn(async () => undefined),
}));

vi.mock("drizzle-orm", () => ({
  eq: () => "eq",
  and: () => "and",
  or: () => "or",
  isNull: () => "isNull",
  gt: () => "gt",
  ilike: () => "ilike",
  inArray: () => "inArray",
  desc: () => "desc",
  count: () => "count",
}));

const { default: app } = await import("../app");

const PDF_BUFFER = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(16, 0)]);

function mockSession(userId = 1) {
  fixtures.sessionRows = [
    {
      session: { id: 1, token: "valid-token", userId, expiresAt: new Date(Date.now() + 100000) },
      user: {
        id: userId,
        email: "user@example.com",
        firstName: "Test",
        lastName: "User",
        role: "employee",
        organizationId: 10,
        avatarUrl: null,
        jobTitle: null,
        department: null,
        phoneNumber: null,
        createdAt: new Date(),
      },
    },
  ];
}

function mockActiveMembership(membershipId = 5, organizationId = 10) {
  fixtures.membershipRows = [
    { id: membershipId, applicationUserId: 1, organizationId, status: "active", expiresAt: null, createdAt: new Date(), updatedAt: new Date() },
  ];
}

function mockPermissions(permissionKeys: string[]) {
  fixtures.membershipRoleRows = [{ roleId: 1 }];
  fixtures.permissionRows = permissionKeys.map((key) => ({ key }));
}

beforeEach(() => {
  fixtures.sessionRows = [];
  fixtures.membershipRows = [];
  fixtures.membershipRoleRows = [];
  fixtures.permissionRows = [];
  fixtures.employeeRows = [];
  fixtures.linkRows = [];
  fixtures.documentRows = [];
  fixtures.inserted = [];
  fixtures.deleted = [];
  fixtures.idCounters = new Map();
});

const CONTRACT_DOCUMENT = {
  id: 1,
  organizationId: 10,
  employeeId: 42,
  categoryCode: "contract",
  fileName: "contract.pdf",
  mimeType: "application/pdf",
  fileSize: 1024,
  uploadedBy: 1,
  createdAt: new Date(),
};

describe("GET /api/organizations/:organizationId/employees/:employeeId/documents", () => {
  it("returns 403 when the caller has no active membership (tenant isolation)", async () => {
    mockSession();
    fixtures.membershipRows = [];

    const res = await request(app).get("/api/organizations/10/employees/42/documents").set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(403);
  });

  it("returns 404 when the employee does not exist", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["employee.read"]);
    fixtures.employeeRows = [];

    const res = await request(app).get("/api/organizations/10/employees/42/documents").set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(404);
  });

  it("lists documents for the employee to a caller holding employee.documents.read (HR)", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["employee.read", "employee.documents.read"]);
    fixtures.employeeRows = [{ id: 42, organizationId: 10, firstName: "Ada", lastName: "Lovelace" }];
    fixtures.documentRows = [CONTRACT_DOCUMENT];

    const res = await request(app).get("/api/organizations/10/employees/42/documents").set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].fileName).toBe("contract.pdf");
  });

  // WWM Employee Access Remediation (2026-09-07): same-tenant privacy — the
  // directory grant alone never reveals a colleague's personnel documents.
  it("returns 403 (no metadata) to a colleague holding only employee.read", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["employee.read"]);
    fixtures.employeeRows = [{ id: 42, organizationId: 10, firstName: "Ada", lastName: "Lovelace" }];
    fixtures.linkRows = [];
    fixtures.documentRows = [CONTRACT_DOCUMENT];

    const res = await request(app).get("/api/organizations/10/employees/42/documents").set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain("contract.pdf");
  });

  it("lists the caller's OWN documents with employee.read alone (ESS My Documents, link resolved server-side)", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["employee.read"]);
    fixtures.employeeRows = [{ id: 42, organizationId: 10, firstName: "Ada", lastName: "Lovelace" }];
    fixtures.linkRows = [{ employeeId: 42, applicationUserId: 1 }];
    fixtures.documentRows = [CONTRACT_DOCUMENT];

    const res = await request(app).get("/api/organizations/10/employees/42/documents").set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].fileName).toBe("contract.pdf");
  });
});

describe("POST /api/organizations/:organizationId/employees/:employeeId/documents", () => {
  it("returns 403 when the membership's role lacks employee.write", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["employee.read"]);
    fixtures.employeeRows = [{ id: 42, organizationId: 10, firstName: "Ada", lastName: "Lovelace" }];

    const res = await request(app)
      .post("/api/organizations/10/employees/42/documents")
      .set("Authorization", "Bearer valid-token")
      .field("categoryCode", "contract")
      .attach("file", PDF_BUFFER, { filename: "contract.pdf", contentType: "application/pdf" });

    expect(res.status).toBe(403);
    expect(fixtures.inserted.find((i) => i.table === "employee_documents")).toBeUndefined();
  });

  it("returns 404 when the employee does not exist", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["employee.write"]);
    fixtures.employeeRows = [];

    const res = await request(app)
      .post("/api/organizations/10/employees/42/documents")
      .set("Authorization", "Bearer valid-token")
      .field("categoryCode", "contract")
      .attach("file", PDF_BUFFER, { filename: "contract.pdf", contentType: "application/pdf" });

    expect(res.status).toBe(404);
  });

  it("returns 400 when categoryCode is missing", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["employee.write"]);
    fixtures.employeeRows = [{ id: 42, organizationId: 10, firstName: "Ada", lastName: "Lovelace" }];

    const res = await request(app)
      .post("/api/organizations/10/employees/42/documents")
      .set("Authorization", "Bearer valid-token")
      .attach("file", PDF_BUFFER, { filename: "contract.pdf", contentType: "application/pdf" });

    expect(res.status).toBe(400);
    expect(fixtures.inserted.find((i) => i.table === "employee_documents")).toBeUndefined();
  });

  it("returns 400 for a file whose content does not match an allowed type", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["employee.write"]);
    fixtures.employeeRows = [{ id: 42, organizationId: 10, firstName: "Ada", lastName: "Lovelace" }];

    const res = await request(app)
      .post("/api/organizations/10/employees/42/documents")
      .set("Authorization", "Bearer valid-token")
      .field("categoryCode", "contract")
      .attach("file", Buffer.from("not a real pdf"), { filename: "fake.pdf", contentType: "application/pdf" });

    expect(res.status).toBe(400);
    expect(fixtures.inserted.find((i) => i.table === "employee_documents")).toBeUndefined();
  });

  it("uploads a valid document and records an audit event", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["employee.write"]);
    fixtures.employeeRows = [{ id: 42, organizationId: 10, firstName: "Ada", lastName: "Lovelace" }];

    const res = await request(app)
      .post("/api/organizations/10/employees/42/documents")
      .set("Authorization", "Bearer valid-token")
      .field("categoryCode", "contract")
      .attach("file", PDF_BUFFER, { filename: "contract.pdf", contentType: "application/pdf" });

    expect(res.status).toBe(201);
    expect(res.body.categoryCode).toBe("contract");
    expect(res.body.fileName).toBe("contract.pdf");
    const docInsert = fixtures.inserted.find((i) => i.table === "employee_documents");
    expect(docInsert).toBeDefined();
    expect((docInsert!.values as Record<string, unknown>).organizationId).toBe(10);
    const auditInsert = fixtures.inserted.find((i) => i.table === "audit_events");
    expect(auditInsert).toBeDefined();
    expect((auditInsert!.values as Record<string, unknown>).eventType).toBe("employee_document.uploaded");
  });
});

describe("DELETE /api/organizations/:organizationId/employees/:employeeId/documents/:documentId", () => {
  it("returns 403 when the membership's role lacks employee.write", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["employee.read"]);
    fixtures.employeeRows = [{ id: 42, organizationId: 10, firstName: "Ada", lastName: "Lovelace" }];

    const res = await request(app).delete("/api/organizations/10/employees/42/documents/1").set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(403);
  });

  it("returns 404 when the document does not exist in this employee's scope", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["employee.write"]);
    fixtures.employeeRows = [{ id: 42, organizationId: 10, firstName: "Ada", lastName: "Lovelace" }];
    fixtures.documentRows = [];

    const res = await request(app).delete("/api/organizations/10/employees/42/documents/1").set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(404);
  });

  it("removes the document and records an audit event", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["employee.write"]);
    fixtures.employeeRows = [{ id: 42, organizationId: 10, firstName: "Ada", lastName: "Lovelace" }];
    fixtures.documentRows = [
      { id: 1, organizationId: 10, employeeId: 42, categoryCode: "contract", fileName: "contract.pdf", storageKey: "documents/mock-key.pdf" },
    ];

    const res = await request(app).delete("/api/organizations/10/employees/42/documents/1").set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(fixtures.deleted.find((d) => d.table === "employee_documents")).toBeDefined();
    const auditInsert = fixtures.inserted.find((i) => i.table === "audit_events");
    expect(auditInsert).toBeDefined();
    expect((auditInsert!.values as Record<string, unknown>).eventType).toBe("employee_document.removed");
  });
});

// WS-26C (U4): the employee's finalized WS-26 form documents reuse the SAME
// authorization boundary as personnel documents (own server-resolved, or
// employee.documents.read). No raw stored-PDF path is exposed here.
describe("GET /api/organizations/:organizationId/employees/:employeeId/form-documents", () => {
  it("returns 403 when the caller has no active membership (tenant isolation)", async () => {
    mockSession();
    fixtures.membershipRows = [];
    const res = await request(app).get("/api/organizations/10/employees/42/form-documents").set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  it("returns 404 when the employee does not exist (a guessed id learns nothing)", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["employee.read"]);
    fixtures.employeeRows = [];
    const res = await request(app).get("/api/organizations/10/employees/42/form-documents").set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(404);
  });

  it("returns 403 to a colleague holding only employee.read (cannot enumerate another's finalized forms)", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["employee.read"]);
    fixtures.employeeRows = [{ id: 42, organizationId: 10, firstName: "Ada", lastName: "Lovelace" }];
    fixtures.linkRows = []; // caller is NOT linked to employee 42 → not own, and no employee.documents.read
    const res = await request(app).get("/api/organizations/10/employees/42/form-documents").set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });
  // The authorized allow-path (own, or employee.documents.read) reuses the exact
  // gate of the documents route above and returns finalized-form metadata; its
  // data boundary is proven end-to-end in wwmEmployeeFormDocsLive.test.ts.
});
