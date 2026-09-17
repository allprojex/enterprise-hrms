/**
 * Core-HR Phase 1 — GET /organizations/:orgId/employees/:employeeId/documents.
 * Seeing the list only because it is your own record is not the document
 * permission: such a caller receives `normal` documents only. Holders of
 * employee.documents.read keep every tier. Colleagues without the permission
 * stay refused, and another organization's employee is not found.
 *
 * The router is mounted on a minimal app with auth/membership stubbed to the
 * caller's own organization; the query-level filter itself is covered by
 * employeeDocumentsList.test.ts.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";

const ORG = 10;

const { state, listMock } = vi.hoisted(() => {
  const state = {
    ownEmployeeId: null as number | null,
    canReadDocuments: false,
    employeesInOrg: new Set<number>([42, 43]),
  };
  const docs = {
    normal: { id: 1, organizationId: 10, employeeId: 42, categoryCode: "cv", fileName: "cv.pdf", mimeType: "application/pdf", fileSize: 10, uploadedBy: 9, confidentiality: "normal", createdAt: new Date() },
    confidential: { id: 2, organizationId: 10, employeeId: 42, categoryCode: "medical", fileName: "medical-note.pdf", mimeType: "application/pdf", fileSize: 10, uploadedBy: 9, confidentiality: "confidential", createdAt: new Date() },
  };
  const listMock = vi.fn(async (_org: number, _emp: number, options: { includeConfidential: boolean }) =>
    options.includeConfidential ? [docs.normal, docs.confidential] : [docs.normal],
  );
  return { state, listMock };
});

vi.mock("../middlewares/requireAuth", () => ({
  requireAuth: (req: { userId?: number; user?: unknown }, _res: unknown, next: () => void) => {
    req.userId = 1;
    req.user = { id: 1, role: "employee" };
    next();
  },
}));

vi.mock("../middlewares/requireMembership", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../middlewares/requireMembership")>()),
  requireMembership:
    (param: string) =>
    (req: { params: Record<string, string>; membership?: unknown }, res: { status: (n: number) => { json: (b: unknown) => void } }, next: () => void) => {
      if (Number(req.params[param]) !== ORG) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
      req.membership = { id: 5, organizationId: ORG, applicationUserId: 1 };
      next();
    },
}));

vi.mock("../middlewares/requirePermission", () => ({
  requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../lib/permissions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/permissions")>()),
  hasPermission: vi.fn(async (_membershipId: number, key: string) => key === "employee.documents.read" && state.canReadDocuments),
}));

vi.mock("../lib/leaveRequests", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/leaveRequests")>()),
  resolveOwnEmployeeId: vi.fn(async () => state.ownEmployeeId),
}));

vi.mock("../lib/employees", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/employees")>()),
  getEmployeeById: vi.fn(async (organizationId: number, employeeId: number) =>
    organizationId === ORG && state.employeesInOrg.has(employeeId) ? { id: employeeId, organizationId } : null,
  ),
}));

vi.mock("../lib/employeeDocuments", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/employeeDocuments")>()),
  listEmployeeDocuments: listMock,
}));

const { default: router } = await import("../routes/employees");
const app = express();
app.use(router);

const listUrl = (employeeId: number, org = ORG) => `/organizations/${org}/employees/${employeeId}/documents`;

beforeEach(() => {
  state.ownEmployeeId = null;
  state.canReadDocuments = false;
  listMock.mockClear();
});

describe("employee document list — confidentiality", () => {
  it("an employee sees their own normal documents and none of the confidential ones", async () => {
    state.ownEmployeeId = 42;
    const res = await request(app).get(listUrl(42));
    expect(res.status).toBe(200);
    expect(listMock).toHaveBeenCalledWith(ORG, 42, { includeConfidential: false });
    expect(res.body.map((d: { fileName: string }) => d.fileName)).toEqual(["cv.pdf"]);
    expect(JSON.stringify(res.body)).not.toContain("medical");
  });

  it("HR holding employee.documents.read still sees every tier", async () => {
    state.canReadDocuments = true;
    const res = await request(app).get(listUrl(42));
    expect(res.status).toBe(200);
    expect(listMock).toHaveBeenCalledWith(ORG, 42, { includeConfidential: true });
    expect(res.body).toHaveLength(2);
  });

  it("HR viewing their own record keeps their permission's full view", async () => {
    state.ownEmployeeId = 42;
    state.canReadDocuments = true;
    const res = await request(app).get(listUrl(42));
    expect(res.status).toBe(200);
    expect(listMock).toHaveBeenCalledWith(ORG, 42, { includeConfidential: true });
  });

  it("a colleague without the permission is refused and nothing is listed", async () => {
    state.ownEmployeeId = 43;
    const res = await request(app).get(listUrl(42));
    expect(res.status).toBe(403);
    expect(listMock).not.toHaveBeenCalled();
  });

  it("an employee who is not in the caller's organization is not found", async () => {
    state.canReadDocuments = true;
    const res = await request(app).get(listUrl(999));
    expect(res.status).toBe(404);
    expect(listMock).not.toHaveBeenCalled();
  });

  it("another organization's path is refused before any lookup", async () => {
    state.canReadDocuments = true;
    const res = await request(app).get(listUrl(42, 20));
    expect(res.status).toBe(403);
    expect(listMock).not.toHaveBeenCalled();
  });
});
