/**
 * VR-01 — vehicle register HTTP authorization boundary. Proves the guard chain
 * each route composes: authentication, the caller's own organization, the
 * vehicle_management module, and then vehicle.read for viewing versus
 * vehicle.manage for administering. The service layer itself is covered by
 * vehicles.test.ts and is stubbed here so this file tests only who may call
 * what.
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
      enabled: moduleKey === "vehicle_management" && state.moduleEnabled,
    })),
    hasPermissionMock: vi.fn(async (_membershipId: number, key: string) => state.permissions.has(key)),
    serviceMocks: {
      listVehicles: vi.fn(async () => [] as unknown[]),
      getVehicleById: vi.fn(async (_org: number, id: number) => (id === 1 ? { id: 1, organizationId: CALLER_ORG, registrationNumber: "GR 1234-20", status: "available" } : null)),
      createVehicle: vi.fn(async () => ({ id: 2, organizationId: CALLER_ORG, registrationNumber: "GR 0001-20", status: "available" })),
      updateVehicle: vi.fn(async () => ({ id: 1, organizationId: CALLER_ORG, registrationNumber: "GR 1234-20", status: "inactive" })),
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

vi.mock("../lib/vehicles", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/vehicles")>()),
  ...serviceMocks,
}));

const { default: router } = await import("../routes/vehicles");
const app = express();
app.use(express.json());
app.use(router);

const AUTH = { Authorization: "Bearer t" };
const base = `/organizations/${CALLER_ORG}/vehicles`;

beforeEach(() => {
  state.moduleEnabled = true;
  state.permissions = new Set<string>();
  getModuleAccessMock.mockClear();
  for (const fn of Object.values(serviceMocks)) fn.mockClear();
});

describe("vehicle register — authentication and organization", () => {
  it("rejects an unauthenticated caller", async () => {
    const res = await request(app).get(base);
    expect(res.status).toBe(401);
    expect(serviceMocks.listVehicles).not.toHaveBeenCalled();
  });

  it("refuses another organization's path", async () => {
    state.permissions = new Set(["vehicle.read"]);
    const res = await request(app).get(`/organizations/${OTHER_ORG}/vehicles`).set(AUTH);
    expect(res.status).toBe(403);
    expect(getModuleAccessMock).not.toHaveBeenCalled();
  });
});

describe("vehicle register — module gate", () => {
  it.each([
    ["get", base],
    ["post", base],
  ] as const)("refuses %s %s when vehicle_management is disabled", async (method, path) => {
    state.moduleEnabled = false;
    state.permissions = new Set(["vehicle.read", "vehicle.manage"]);
    const res = await request(app)[method](path).set(AUTH).send({ registrationNumber: "GR 1" });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/vehicle_management/);
    expect(serviceMocks.listVehicles).not.toHaveBeenCalled();
    expect(serviceMocks.createVehicle).not.toHaveBeenCalled();
  });

  it("evaluates the module for the caller's own organization", async () => {
    state.permissions = new Set(["vehicle.read"]);
    await request(app).get(base).set(AUTH);
    expect(getModuleAccessMock).toHaveBeenCalledWith(CALLER_ORG, "vehicle_management");
  });
});

describe("vehicle register — permissions", () => {
  it("vehicle.read may list and view, but not create or change", async () => {
    state.permissions = new Set(["vehicle.read"]);
    expect((await request(app).get(base).set(AUTH)).status).toBe(200);
    expect((await request(app).get(`${base}/1`).set(AUTH)).status).toBe(200);
    expect((await request(app).post(base).set(AUTH).send({ registrationNumber: "GR 0001-20" })).status).toBe(403);
    expect((await request(app).patch(`${base}/1`).set(AUTH).send({ model: "X" })).status).toBe(403);
    expect(serviceMocks.createVehicle).not.toHaveBeenCalled();
    expect(serviceMocks.updateVehicle).not.toHaveBeenCalled();
  });

  it("vehicle.manage may create and change", async () => {
    state.permissions = new Set(["vehicle.manage"]);
    expect((await request(app).post(base).set(AUTH).send({ registrationNumber: "GR 0001-20" })).status).toBe(201);
    expect((await request(app).patch(`${base}/1`).set(AUTH).send({ status: "inactive" })).status).toBe(200);
  });

  it("an asset administrator gets nothing here — vehicles are their own authority", async () => {
    state.permissions = new Set(["asset_management.manage"]);
    expect((await request(app).get(base).set(AUTH)).status).toBe(403);
    expect((await request(app).post(base).set(AUTH).send({ registrationNumber: "GR 0001-20" })).status).toBe(403);
  });
});

describe("vehicle register — request shape", () => {
  beforeEach(() => {
    state.permissions = new Set(["vehicle.read", "vehicle.manage"]);
  });

  it("400s an invalid vehicle id", async () => {
    const res = await request(app).get(`${base}/not-a-number`).set(AUTH);
    expect(res.status).toBe(400);
    expect(serviceMocks.getVehicleById).not.toHaveBeenCalled();
  });

  it("404s a vehicle the caller's organization does not have", async () => {
    const res = await request(app).get(`${base}/4242`).set(AUTH);
    expect(res.status).toBe(404);
  });

  it("400s a create without a registration number", async () => {
    const res = await request(app).post(base).set(AUTH).send({ make: "Toyota" });
    expect(res.status).toBe(400);
    expect(serviceMocks.createVehicle).not.toHaveBeenCalled();
  });

  it("passes only server-resolved organization and actor identity to the service", async () => {
    await request(app).post(base).set(AUTH).send({ registrationNumber: "GR 0001-20", organizationId: OTHER_ORG });
    expect(serviceMocks.createVehicle).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: CALLER_ORG, actorApplicationUserId: 1, actorMembershipId: 5 }),
    );
  });
});
