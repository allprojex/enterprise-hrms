/**
 * Core-HR Phase 1 — the employee-facing WS-13 `my-*` routes are Employee
 * Self-Service surfaces and must obey that module, exactly like /me/employee.
 * HR/administrator request routes are not self-service and stay ungated by it.
 *
 * The router is mounted on a minimal app. Auth/membership/permission
 * middleware are stubbed to their observable contract (membership resolves
 * only the caller's own organization), and the request services are stubbed —
 * this suite is about which routes the module gate covers, and against which
 * organization it is evaluated.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";

const CALLER_ORG = 10;
const OTHER_ORG = 20;

const { moduleState, getModuleAccessMock } = vi.hoisted(() => {
  const moduleState = { enabledOrgs: new Set<number>() };
  return {
    moduleState,
    getModuleAccessMock: vi.fn(async (organizationId: number, moduleKey: string) => ({
      found: true,
      enabled: moduleKey === "employee_self_service" && moduleState.enabledOrgs.has(organizationId),
    })),
  };
});

vi.mock("../middlewares/requireAuth", () => ({
  requireAuth: (req: { headers: Record<string, string>; userId?: number; user?: unknown }, res: { status: (n: number) => { json: (b: unknown) => void } }, next: () => void) => {
    if (!req.headers.authorization) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    req.userId = 1;
    req.user = { id: 1, role: "employee" };
    next();
  },
}));

vi.mock("../middlewares/requireMembership", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../middlewares/requireMembership")>()),
  // The caller is a member of CALLER_ORG only — the same fail-closed contract
  // the real middleware enforces from organization_memberships.
  requireMembership:
    (param: string) =>
    (req: { params: Record<string, string>; membership?: unknown }, res: { status: (n: number) => { json: (b: unknown) => void } }, next: () => void) => {
      if (Number(req.params[param]) !== CALLER_ORG) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
      req.membership = { id: 5, organizationId: CALLER_ORG, applicationUserId: 1 };
      next();
    },
}));

vi.mock("../middlewares/requirePermission", () => ({
  requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../lib/organizationModules", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/organizationModules")>()),
  getModuleAccess: getModuleAccessMock,
}));

vi.mock("../lib/leaveRequests", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/leaveRequests")>()),
  resolveOwnEmployeeId: vi.fn(async () => null),
}));

vi.mock("../lib/employeeRequests/dataChange", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/employeeRequests/dataChange")>()),
  listRequests: vi.fn(async () => []),
}));

vi.mock("../lib/employeeRequests/serviceRequests", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/employeeRequests/serviceRequests")>()),
  listTypes: vi.fn(async () => []),
}));

const { default: router } = await import("../routes/employeeRequests");
const app = express();
app.use(express.json());
app.use(router);

const AUTH = { Authorization: "Bearer t" };

const SELF_SERVICE_ROUTES: Array<["get" | "post", string]> = [
  ["get", `/organizations/${CALLER_ORG}/my-data-change-requests`],
  ["post", `/organizations/${CALLER_ORG}/my-data-change-requests`],
  ["post", `/organizations/${CALLER_ORG}/my-data-change-requests/1/withdraw`],
  ["get", `/organizations/${CALLER_ORG}/my-data-change-fields`],
  ["get", `/organizations/${CALLER_ORG}/my-service-request-types`],
  ["get", `/organizations/${CALLER_ORG}/my-service-requests`],
  ["post", `/organizations/${CALLER_ORG}/my-service-requests`],
  ["post", `/organizations/${CALLER_ORG}/my-service-requests/1/respond`],
  ["post", `/organizations/${CALLER_ORG}/my-service-requests/1/withdraw`],
];

beforeEach(() => {
  moduleState.enabledOrgs = new Set();
  getModuleAccessMock.mockClear();
});

describe("Employee Self-Service module gate on WS-13 my-* routes", () => {
  it.each(SELF_SERVICE_ROUTES)("%s %s is refused when Employee Self-Service is disabled", async (method, path) => {
    const res = await request(app)[method](path).set(AUTH).send({});
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/employee_self_service/);
    expect(getModuleAccessMock).toHaveBeenCalledWith(CALLER_ORG, "employee_self_service");
  });

  it.each([
    `/organizations/${CALLER_ORG}/my-data-change-requests`,
    `/organizations/${CALLER_ORG}/my-data-change-fields`,
    `/organizations/${CALLER_ORG}/my-service-request-types`,
    `/organizations/${CALLER_ORG}/my-service-requests`,
  ])("GET %s works when Employee Self-Service is enabled", async (path) => {
    moduleState.enabledOrgs.add(CALLER_ORG);
    const res = await request(app).get(path).set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("evaluates the module for the caller's own organization — enabling it elsewhere grants nothing", async () => {
    moduleState.enabledOrgs.add(OTHER_ORG);
    const own = await request(app).get(`/organizations/${CALLER_ORG}/my-data-change-requests`).set(AUTH);
    expect(own.status).toBe(403);
    const foreign = await request(app).get(`/organizations/${OTHER_ORG}/my-data-change-requests`).set(AUTH);
    expect(foreign.status).toBe(403);
    expect(getModuleAccessMock).not.toHaveBeenCalledWith(OTHER_ORG, expect.anything());
  });

  it("still rejects an unauthenticated caller before any module check", async () => {
    const res = await request(app).get(`/organizations/${CALLER_ORG}/my-data-change-requests`);
    expect(res.status).toBe(401);
    expect(getModuleAccessMock).not.toHaveBeenCalled();
  });
});

describe("HR/administrator WS-13 routes are not self-service", () => {
  it("the HR data-change queue is unaffected when Employee Self-Service is disabled", async () => {
    const res = await request(app).get(`/organizations/${CALLER_ORG}/data-change-requests`).set(AUTH);
    expect(res.status).toBe(200);
    expect(getModuleAccessMock).not.toHaveBeenCalled();
  });
});
