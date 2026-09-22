/**
 * VR-02B — Vehicle Request self-service HTTP boundary.
 *
 * Proves what each route composes: authentication, the caller's own
 * organization, the asset_management module, the requestable-vehicles grant,
 * strict offset-bearing timestamps, that NO identity from the body can reach
 * the service, and how each fail-closed service error surfaces. The service's
 * own authorization and data rules are proved against a real database in
 * vehicleRequestSubmissionLive.test.ts; here it is stubbed so this file tests
 * only the HTTP layer.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";

const CALLER_ORG = 10;
const OTHER_ORG = 20;
const CALLER_MEMBERSHIP = 5;
const CALLER_USER = 1;

const { state, getModuleAccessMock, hasPermissionMock, serviceMocks } = vi.hoisted(() => {
  const state = { moduleEnabled: true, permissions: new Set<string>() };
  const view = {
    id: 42,
    requestReference: "VR-00007",
    requestType: "employee",
    status: "pending",
    requesterEmployeeId: 9,
    requestingDepartmentId: 3,
    requestingDepartmentName: "Finance",
    vehicleId: 11,
    vehicleRegistrationNumber: "GR 1234-26",
    vehicleMake: "Toyota",
    vehicleModel: "Hilux",
    purpose: "Field visit",
    destination: null,
    plannedTimeOut: "2030-01-01T09:00:00.000Z",
    plannedTimeIn: "2030-01-01T13:00:00.000Z",
    totalStages: 2,
    currentStageOrder: 1,
    submittedAt: "2029-12-31T10:00:00.000Z",
  };
  return {
    state,
    getModuleAccessMock: vi.fn(async (_organizationId: number, moduleKey: string) => ({
      found: true,
      enabled: moduleKey === "asset_management" && state.moduleEnabled,
    })),
    hasPermissionMock: vi.fn(async (_membershipId: number, key: string) => state.permissions.has(key)),
    serviceMocks: {
      view,
      submitVehicleRequest: vi.fn(async () => ({ id: 42 })),
      listMyVehicleRequests: vi.fn(async () => [view]),
      getMyVehicleRequest: vi.fn(async (_org: number, _m: number, id: number) => (id === 42 ? view : null)),
      listRequestableVehicles: vi.fn(async () => [
        { id: 11, registrationNumber: "GR 1234-26", make: "Toyota", model: "Hilux", description: null },
      ]),
      getSubmissionContext: vi.fn(async () => ({
        canSubmitEmployeeRequest: true,
        canSubmitDepartmentRequest: false,
        department: { id: 3, name: "Finance" },
        approvalWorkflowConfigured: true,
        blockedReason: null,
      })),
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
    req.userId = CALLER_USER;
    req.user = { id: CALLER_USER, role: "employee" };
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
      req.membership = { id: CALLER_MEMBERSHIP, organizationId: CALLER_ORG, applicationUserId: CALLER_USER };
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

vi.mock("../lib/vehicleRequestSubmission", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/vehicleRequestSubmission")>();
  const { view: _view, ...fns } = serviceMocks;
  return { ...actual, ...fns };
});

const svc = await import("../lib/vehicleRequestSubmission");
const { default: router } = await import("../routes/vehicleRequests");
const app = express();
app.use(express.json());
app.use(router);

const AUTH = { Authorization: "Bearer t" };
const base = `/organizations/${CALLER_ORG}/my-vehicle-requests`;
const VALID = {
  requestType: "employee",
  vehicleId: 11,
  purpose: "Field visit",
  destination: "Kumasi",
  plannedTimeOut: "2030-01-01T09:00:00.000Z",
  plannedTimeIn: "2030-01-01T13:00:00+00:00",
};

beforeEach(() => {
  state.moduleEnabled = true;
  state.permissions = new Set();
  vi.clearAllMocks();
});

describe("guard chain on every route", () => {
  const routes: [string, string][] = [
    ["get", base],
    ["post", base],
    ["get", `${base}/context`],
    ["get", `${base}/requestable-vehicles`],
    ["get", `${base}/42`],
  ];

  it.each(routes)("%s %s rejects an unauthenticated caller", async (method, path) => {
    const res = await (request(app) as any)[method](path).send(VALID);
    expect(res.status).toBe(401);
  });

  it.each(routes)("%s %s refuses another organization's path", async (method, path) => {
    const res = await (request(app) as any)[method](path.replace(`/${CALLER_ORG}/`, `/${OTHER_ORG}/`)).set(AUTH).send(VALID);
    expect(res.status).toBe(403);
  });

  it.each(routes)("%s %s refuses when asset_management is disabled", async (method, path) => {
    state.moduleEnabled = false;
    state.permissions = new Set(["vehicle_request.write.own", "vehicle_request.write.department"]);
    const res = await (request(app) as any)[method](path).set(AUTH).send(VALID);
    expect(res.status).toBe(403);
    expect(serviceMocks.submitVehicleRequest).not.toHaveBeenCalled();
    expect(serviceMocks.listMyVehicleRequests).not.toHaveBeenCalled();
  });
});

describe("own-scope reads", () => {
  it("lists MY requests with no permission key, scoped to the resolved membership", async () => {
    const res = await request(app).get(base).set(AUTH);
    expect(res.status).toBe(200);
    expect(serviceMocks.listMyVehicleRequests).toHaveBeenCalledWith(CALLER_ORG, CALLER_MEMBERSHIP);
  });

  it("a request that is not mine answers 404, and a malformed id answers 404 too", async () => {
    expect((await request(app).get(`${base}/43`).set(AUTH)).status).toBe(404);
    expect((await request(app).get(`${base}/4x2`).set(AUTH)).status).toBe(404);
    expect(serviceMocks.getMyVehicleRequest).toHaveBeenCalledWith(CALLER_ORG, CALLER_MEMBERSHIP, 43);
  });

  it("/context and /requestable-vehicles are not swallowed by /:requestId", async () => {
    state.permissions = new Set(["vehicle_request.write.own"]);
    expect((await request(app).get(`${base}/context`).set(AUTH)).status).toBe(200);
    expect((await request(app).get(`${base}/requestable-vehicles`).set(AUTH)).status).toBe(200);
    expect(serviceMocks.getMyVehicleRequest).not.toHaveBeenCalled();
  });
});

describe("requestable vehicles", () => {
  it("needs a submission grant — none at all is refused", async () => {
    const res = await request(app).get(`${base}/requestable-vehicles`).set(AUTH);
    expect(res.status).toBe(403);
    expect(serviceMocks.listRequestableVehicles).not.toHaveBeenCalled();
  });

  it.each([["vehicle_request.write.own"], ["vehicle_request.write.department"]])("%s alone is enough", async (key) => {
    state.permissions = new Set([key]);
    const res = await request(app).get(`${base}/requestable-vehicles`).set(AUTH);
    expect(res.status).toBe(200);
    expect(serviceMocks.listRequestableVehicles).toHaveBeenCalledWith(CALLER_ORG);
  });

  it("approve, read.all and asset administration do not open it", async () => {
    state.permissions = new Set(["vehicle_request.approve", "vehicle_request.read.all", "asset_management.manage"]);
    expect((await request(app).get(`${base}/requestable-vehicles`).set(AUTH)).status).toBe(403);
  });
});

describe("submission input", () => {
  it("rejects a naive timestamp that names no UTC offset", async () => {
    const res = await request(app)
      .post(base)
      .set(AUTH)
      .send({ ...VALID, plannedTimeOut: "2030-01-01T09:00" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Planned Time Out must be a timestamp with an explicit UTC offset/);
    expect(serviceMocks.submitVehicleRequest).not.toHaveBeenCalled();
  });

  it.each([
    ["plannedTimeOut", "Planned Time Out is required"],
    ["plannedTimeIn", "Expected Time In is required"],
  ])("requires %s", async (field, message) => {
    const body: Record<string, unknown> = { ...VALID };
    delete body[field];
    const res = await request(app).post(base).set(AUTH).send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(message);
  });

  it("requires a purpose and a known request type", async () => {
    expect((await request(app).post(base).set(AUTH).send({ ...VALID, purpose: "" })).status).toBe(400);
    expect((await request(app).post(base).set(AUTH).send({ ...VALID, requestType: "fleet" })).status).toBe(400);
    expect(serviceMocks.submitVehicleRequest).not.toHaveBeenCalled();
  });

  it("no identity in the body can reach the service", async () => {
    const res = await request(app)
      .post(base)
      .set(AUTH)
      .send({
        ...VALID,
        organizationId: OTHER_ORG,
        requesterEmployeeId: 999,
        requestingDepartmentId: 888,
        submittedByMembershipId: 777,
        status: "approved",
        totalStages: 0,
      });
    expect(res.status).toBe(201);
    expect(serviceMocks.submitVehicleRequest).toHaveBeenCalledTimes(1);
    const [actor, input] = serviceMocks.submitVehicleRequest.mock.calls[0] as unknown as [Record<string, unknown>, Record<string, unknown>];
    expect(actor).toEqual({ organizationId: CALLER_ORG, membershipId: CALLER_MEMBERSHIP, applicationUserId: CALLER_USER });
    expect(Object.keys(input).sort()).toEqual(["destination", "plannedTimeIn", "plannedTimeOut", "purpose", "requestType", "vehicleId"]);
    expect(input.plannedTimeOut).toBeInstanceOf(Date);
    expect((input.plannedTimeIn as Date).toISOString()).toBe("2030-01-01T13:00:00.000Z");
  });

  it("answers 201 with the submitter's view, including the generated reference", async () => {
    const res = await request(app).post(base).set(AUTH).send(VALID);
    expect(res.status).toBe(201);
    expect(res.body.requestReference).toBe("VR-00007");
    expect(res.body.status).toBe("pending");
  });
});

describe("fail-closed service errors surface without leaking", () => {
  const cases: [string, () => Error, number][] = [
    ["not authorized for the type", () => new svc.VehicleRequestNotAuthorizedError("employee"), 403],
    ["employee not currently active", () => new svc.VehicleRequestEmployeeNotActiveError(), 403],
    ["no linked employee", () => new svc.VehicleRequestNoEmployeeLinkError(), 400],
    ["no department", () => new svc.VehicleRequestNoDepartmentError(), 400],
    ["inactive department", () => new svc.VehicleRequestDepartmentInactiveError(), 400],
    ["vehicle not found (incl. foreign)", () => new svc.VehicleRequestVehicleNotFoundError(), 400],
    ["vehicle not available", () => new svc.VehicleRequestVehicleNotAvailableError(), 409],
    ["invalid input", () => new svc.VehicleRequestInvalidInputError("Planned Time Out cannot be in the past"), 400],
    ["no approval stages", () => new svc.VehicleRequestNoApprovalStagesError(), 409],
  ];

  it.each(cases)("%s", async (_label, make, status) => {
    const err = make();
    serviceMocks.submitVehicleRequest.mockRejectedValueOnce(err);
    const res = await request(app).post(base).set(AUTH).send(VALID);
    expect(res.status).toBe(status);
    expect(res.body).toEqual({ error: err.message });
  });

  it("the zero-stage refusal carries the owner's exact wording", async () => {
    serviceMocks.submitVehicleRequest.mockRejectedValueOnce(new svc.VehicleRequestNoApprovalStagesError());
    const res = await request(app).post(base).set(AUTH).send(VALID);
    expect(res.body.error).toBe("Vehicle Request approval workflow has not been configured. Please contact your administrator.");
  });
});
