/**
 * VR-02A — approval-stage configuration HTTP authorization boundary.
 *
 * Proves the guard chain each route composes: authentication, the caller's own
 * organization, the asset_management module, and `asset_management.manage`.
 *
 * The load-bearing assertion is the negative one: holding the whole
 * `vehicle_request.*` family must NOT open stage configuration. An approver
 * decides requests; they do not get to rewrite the chain that appointed them.
 * The service layer is covered by vehicleRequestStages.test.ts and is stubbed
 * here so this file tests only who may call what.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";

const CALLER_ORG = 10;
const OTHER_ORG = 20;

const { state, getModuleAccessMock, hasPermissionMock, serviceMocks } = vi.hoisted(() => {
  const state = { moduleEnabled: true, permissions: new Set<string>() };
  return {
    state,
    getModuleAccessMock: vi.fn(async (_organizationId: number, moduleKey: string) => ({
      found: true,
      enabled: moduleKey === "asset_management" && state.moduleEnabled,
    })),
    hasPermissionMock: vi.fn(async (_membershipId: number, key: string) => state.permissions.has(key)),
    serviceMocks: {
      listStages: vi.fn(async () => [] as unknown[]),
      getStageById: vi.fn(async (_org: number, id: number) =>
        id === 1 ? { id: 1, organizationId: CALLER_ORG, purpose: "vehicle_request", stageOrder: 1, name: "HOD", resolverType: "department_head", resolverConfig: {} } : null,
      ),
      createStage: vi.fn(async () => ({
        id: 2,
        organizationId: CALLER_ORG,
        purpose: "vehicle_request",
        stageOrder: 2,
        name: "Transport Officer",
        resolverType: "department_head",
        resolverConfig: {},
      })),
      updateStage: vi.fn(async () => ({
        id: 1,
        organizationId: CALLER_ORG,
        purpose: "vehicle_request",
        stageOrder: 1,
        name: "Renamed",
        resolverType: "department_head",
        resolverConfig: {},
      })),
      deleteStage: vi.fn(async () => undefined),
    },
  };
});

vi.mock("../middlewares/requireAuth", () => ({
  requireAuth: (
    req: { headers: Record<string, string>; userId?: number; user?: unknown },
    res: { status: (n: number) => { json: (b: unknown) => void } },
    next: () => void,
  ) => {
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
  requireMembership:
    (param: string) =>
    (
      req: { params: Record<string, string>; membership?: unknown },
      res: { status: (n: number) => { json: (b: unknown) => void } },
      next: () => void,
    ) => {
      if (Number(req.params[param]) !== CALLER_ORG) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
      req.membership = { id: 5, organizationId: CALLER_ORG, applicationUserId: 1 };
      next();
    },
}));

vi.mock("../lib/organizationModules", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/organizationModules")>()),
  getModuleAccess: getModuleAccessMock,
}));

vi.mock("../lib/permissions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/permissions")>()),
  hasPermission: hasPermissionMock,
}));

vi.mock("../lib/vehicleRequestStages", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/vehicleRequestStages")>()),
  ...serviceMocks,
}));

const { default: router } = await import("../routes/vehicleRequestApprovalStages");
const app = express();
app.use(express.json());
app.use(router);

const AUTH = { Authorization: "Bearer t" };
const base = `/organizations/${CALLER_ORG}/vehicle-request-approval-stages`;
const ADMIN = new Set(["asset_management.manage"]);
const VALID_BODY = { stageOrder: 2, name: "Transport Officer", resolverType: "department_head" };

beforeEach(() => {
  state.moduleEnabled = true;
  state.permissions = new Set<string>();
  getModuleAccessMock.mockClear();
  for (const fn of Object.values(serviceMocks)) fn.mockClear();
});

describe("stage configuration — authentication and organization", () => {
  it("rejects an unauthenticated caller", async () => {
    const res = await request(app).get(base);
    expect(res.status).toBe(401);
    expect(serviceMocks.listStages).not.toHaveBeenCalled();
  });

  it("refuses another organization's path", async () => {
    state.permissions = ADMIN;
    const res = await request(app).get(`/organizations/${OTHER_ORG}/vehicle-request-approval-stages`).set(AUTH);
    expect(res.status).toBe(403);
    expect(getModuleAccessMock).not.toHaveBeenCalled();
  });

  it("passes only the server-resolved organization and actor to the service", async () => {
    state.permissions = ADMIN;
    await request(app).post(base).set(AUTH).send({ ...VALID_BODY, organizationId: OTHER_ORG });
    expect(serviceMocks.createStage).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: CALLER_ORG, actorApplicationUserId: 1, actorMembershipId: 5 }),
    );
  });
});

describe("stage configuration — module gate", () => {
  it.each([
    ["get", base],
    ["post", base],
  ] as const)("refuses %s %s when asset_management is disabled", async (method, path) => {
    state.moduleEnabled = false;
    state.permissions = ADMIN;
    const res = await request(app)[method](path).set(AUTH).send(VALID_BODY);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/asset_management/);
    expect(serviceMocks.listStages).not.toHaveBeenCalled();
    expect(serviceMocks.createStage).not.toHaveBeenCalled();
  });

  it("evaluates the module for the caller's own organization", async () => {
    state.permissions = ADMIN;
    await request(app).get(base).set(AUTH);
    expect(getModuleAccessMock).toHaveBeenCalledWith(CALLER_ORG, "asset_management");
  });
});

describe("stage configuration — permissions", () => {
  it("asset_management.manage may read and administer the chain", async () => {
    state.permissions = ADMIN;
    expect((await request(app).get(base).set(AUTH)).status).toBe(200);
    expect((await request(app).get(`${base}/1`).set(AUTH)).status).toBe(200);
    expect((await request(app).post(base).set(AUTH).send(VALID_BODY)).status).toBe(201);
    expect((await request(app).patch(`${base}/1`).set(AUTH).send({ name: "Renamed" })).status).toBe(200);
    expect((await request(app).delete(`${base}/1`).set(AUTH)).status).toBe(204);
  });

  it("the ENTIRE vehicle_request.* family cannot administer the chain", async () => {
    // The whole point of the split: an approver decides requests; they never
    // get to rewrite the chain that appointed them.
    state.permissions = new Set([
      "vehicle_request.write.own",
      "vehicle_request.write.department",
      "vehicle_request.approve",
      "vehicle_request.read.all",
    ]);
    expect((await request(app).get(base).set(AUTH)).status).toBe(403);
    expect((await request(app).get(`${base}/1`).set(AUTH)).status).toBe(403);
    expect((await request(app).post(base).set(AUTH).send(VALID_BODY)).status).toBe(403);
    expect((await request(app).patch(`${base}/1`).set(AUTH).send({ name: "x" })).status).toBe(403);
    expect((await request(app).delete(`${base}/1`).set(AUTH)).status).toBe(403);
    expect(serviceMocks.listStages).not.toHaveBeenCalled();
    expect(serviceMocks.createStage).not.toHaveBeenCalled();
    expect(serviceMocks.updateStage).not.toHaveBeenCalled();
    expect(serviceMocks.deleteStage).not.toHaveBeenCalled();
  });

  it("an ordinary employee's own-request key opens nothing here", async () => {
    state.permissions = new Set(["vehicle_request.write.own"]);
    expect((await request(app).get(base).set(AUTH)).status).toBe(403);
    expect((await request(app).post(base).set(AUTH).send(VALID_BODY)).status).toBe(403);
  });
});

describe("stage configuration — request shape", () => {
  beforeEach(() => {
    state.permissions = ADMIN;
  });

  it("400s an invalid stage id", async () => {
    const res = await request(app).get(`${base}/not-a-number`).set(AUTH);
    expect(res.status).toBe(400);
    expect(serviceMocks.getStageById).not.toHaveBeenCalled();
  });

  it("404s a stage the caller's organization does not have", async () => {
    const res = await request(app).get(`${base}/4242`).set(AUTH);
    expect(res.status).toBe(404);
  });

  it("400s a create missing its required fields", async () => {
    const res = await request(app).post(base).set(AUTH).send({ name: "No order or resolver" });
    expect(res.status).toBe(400);
    expect(serviceMocks.createStage).not.toHaveBeenCalled();
  });

  it("400s an unknown resolver type", async () => {
    const res = await request(app).post(base).set(AUTH).send({ stageOrder: 1, name: "Bad", resolverType: "whoever_is_free" });
    expect(res.status).toBe(400);
    expect(serviceMocks.createStage).not.toHaveBeenCalled();
  });
});
