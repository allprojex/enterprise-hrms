/**
 * VR-02B — Vehicle Request Employee Self-Service routes.
 *
 * Every route runs requireAuth → requireMembership(:organizationId) →
 * requireModuleEnabled(asset_management). The organization is always the
 * caller's resolved membership, never the body.
 *
 * WHO MAY DO WHAT
 *   - Reading YOUR OWN requests needs no permission key ("owning your own data
 *     is not an operational grant" — the ESS precedent). "Own" is what this
 *     membership submitted; it is never widened by department membership or by
 *     `vehicle_request.read.all`.
 *   - Submitting needs the key for the request type: `vehicle_request.write.own`
 *     for an employee request, `vehicle_request.write.department` for a
 *     department request. The two are independent siblings, so the check lives
 *     in the service rather than in a route-level middleware:
 *     `requireAnyPermission` is reserved for read/manage pairs where one key
 *     implies the other, which these do not.
 *   - Listing requestable vehicles needs either submission key.
 *
 * ORDERING IS LOAD-BEARING: the literal sub-paths (/context,
 * /requestable-vehicles) are registered before /:requestId, or Express would
 * read them as request ids.
 */
import { Router, type Response } from "express";
import { SubmitMyVehicleRequestBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requireModuleEnabled } from "../middlewares/requireModuleEnabled";
import { ASSET_MANAGEMENT_MODULE_KEY } from "../lib/assetManagementAuthorization";
import {
  submitVehicleRequest,
  listMyVehicleRequests,
  getMyVehicleRequest,
  listRequestableVehicles,
  getSubmissionContext,
  holdsAnySubmissionPermission,
  VehicleRequestNotAuthorizedError,
  VehicleRequestNoEmployeeLinkError,
  VehicleRequestEmployeeNotActiveError,
  VehicleRequestNoDepartmentError,
  VehicleRequestDepartmentInactiveError,
  VehicleRequestVehicleNotFoundError,
  VehicleRequestVehicleNotAvailableError,
  VehicleRequestInvalidInputError,
  VehicleRequestNoApprovalStagesError,
} from "../lib/vehicleRequestSubmission";

const router = Router();

/**
 * A timestamp the API accepts must name its own UTC offset (`Z` or `±hh:mm`).
 * A naive "2026-09-22T10:00" would be read in the SERVER's timezone, silently
 * shifting a requester's local time; refusing it keeps every comparison an
 * absolute instant. The web client always sends `Date.prototype.toISOString()`.
 */
const OFFSET_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;

function parseRequestId(raw: unknown): number {
  const n = Number.parseInt(String(raw), 10);
  return Number.isInteger(n) && n > 0 && String(n) === String(raw) ? n : NaN;
}

function handleSubmissionError(err: unknown, res: Response): boolean {
  if (err instanceof VehicleRequestNotAuthorizedError || err instanceof VehicleRequestEmployeeNotActiveError) {
    res.status(403).json({ error: err.message });
    return true;
  }
  if (err instanceof VehicleRequestVehicleNotAvailableError || err instanceof VehicleRequestNoApprovalStagesError) {
    res.status(409).json({ error: err.message });
    return true;
  }
  if (
    err instanceof VehicleRequestNoEmployeeLinkError ||
    err instanceof VehicleRequestNoDepartmentError ||
    err instanceof VehicleRequestDepartmentInactiveError ||
    err instanceof VehicleRequestVehicleNotFoundError ||
    err instanceof VehicleRequestInvalidInputError
  ) {
    res.status(400).json({ error: err.message });
    return true;
  }
  return false;
}

// GET /organizations/:organizationId/my-vehicle-requests
router.get(
  "/organizations/:organizationId/my-vehicle-requests",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(ASSET_MANAGEMENT_MODULE_KEY),
  async (req: MembershipRequest, res): Promise<void> => {
    const requests = await listMyVehicleRequests(req.membership!.organizationId, req.membership!.id);
    res.json(requests);
  },
);

// POST /organizations/:organizationId/my-vehicle-requests
router.post(
  "/organizations/:organizationId/my-vehicle-requests",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(ASSET_MANAGEMENT_MODULE_KEY),
  async (req: MembershipRequest, res): Promise<void> => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    for (const [field, label] of [
      ["plannedTimeOut", "Planned Time Out"],
      ["plannedTimeIn", "Expected Time In"],
    ] as const) {
      const raw = body[field];
      if (raw === undefined || raw === null || raw === "") {
        res.status(400).json({ error: `${label} is required` });
        return;
      }
      if (typeof raw !== "string" || !OFFSET_TIMESTAMP.test(raw)) {
        res.status(400).json({ error: `${label} must be a timestamp with an explicit UTC offset` });
        return;
      }
    }
    // The generated schema strips unknown keys, so any organizationId,
    // requesterEmployeeId, requestingDepartmentId or submitter a client sends
    // is discarded here and can never reach the service.
    const parsed = SubmitMyVehicleRequestBody.safeParse(body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const actor = {
      organizationId: req.membership!.organizationId,
      membershipId: req.membership!.id,
      applicationUserId: req.userId!,
    };
    try {
      const created = await submitVehicleRequest(actor, {
        requestType: parsed.data.requestType,
        vehicleId: parsed.data.vehicleId,
        purpose: parsed.data.purpose,
        destination: parsed.data.destination ?? null,
        plannedTimeOut: parsed.data.plannedTimeOut,
        plannedTimeIn: parsed.data.plannedTimeIn,
      });
      const view = await getMyVehicleRequest(actor.organizationId, actor.membershipId, created.id);
      res.status(201).json(view);
    } catch (err) {
      if (handleSubmissionError(err, res)) return;
      throw err;
    }
  },
);

// GET /organizations/:organizationId/my-vehicle-requests/context
router.get(
  "/organizations/:organizationId/my-vehicle-requests/context",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(ASSET_MANAGEMENT_MODULE_KEY),
  async (req: MembershipRequest, res): Promise<void> => {
    const context = await getSubmissionContext({
      organizationId: req.membership!.organizationId,
      membershipId: req.membership!.id,
      applicationUserId: req.userId!,
    });
    res.json(context);
  },
);

// GET /organizations/:organizationId/my-vehicle-requests/requestable-vehicles
router.get(
  "/organizations/:organizationId/my-vehicle-requests/requestable-vehicles",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(ASSET_MANAGEMENT_MODULE_KEY),
  async (req: MembershipRequest, res): Promise<void> => {
    if (!(await holdsAnySubmissionPermission(req.membership!.id))) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const vehicles = await listRequestableVehicles(req.membership!.organizationId);
    res.json(vehicles);
  },
);

// GET /organizations/:organizationId/my-vehicle-requests/:requestId
router.get(
  "/organizations/:organizationId/my-vehicle-requests/:requestId",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(ASSET_MANAGEMENT_MODULE_KEY),
  async (req: MembershipRequest, res): Promise<void> => {
    const requestId = parseRequestId(req.params.requestId);
    if (Number.isNaN(requestId)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const request = await getMyVehicleRequest(req.membership!.organizationId, req.membership!.id, requestId);
    if (!request) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(request);
  },
);

export default router;
