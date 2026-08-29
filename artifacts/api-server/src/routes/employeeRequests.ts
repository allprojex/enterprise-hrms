import { Router } from "express";
import {
  CreateDataChangeRequestBody,
  SubmitMyDataChangeRequestBody,
  DecideDataChangeRequestBody,
  RejectDataChangeRequestBody,
  ReturnDataChangeRequestBody,
  SetDataChangeFieldPolicyBody,
  CreateRequestApprovalStageBody,
  CreateServiceRequestTypeBody,
  UpdateServiceRequestTypeBody,
  CreateServiceRequestBody,
  SubmitMyServiceRequestBody,
  AcknowledgeServiceRequestBody,
  AssignServiceRequestBody,
  ApproveServiceRequestBody,
  RejectServiceRequestBody,
  RequestServiceRequestInformationBody,
  RespondToServiceRequestBody,
  FulfilServiceRequestBody,
  CloseServiceRequestBody,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import { hasPermission } from "../lib/permissions";
import { resolveOwnEmployeeId } from "../lib/leaveRequests";
import * as dataChange from "../lib/employeeRequests/dataChange";
import * as serviceRequests from "../lib/employeeRequests/serviceRequests";
import * as stages from "../lib/employeeRequests/approvalStages";
import { ELIGIBLE_FIELDS, UnknownEligibleFieldError, FieldNotEligibleForOriginError } from "../lib/employeeRequests/eligibleFields";

/**
 * WS-13 — Employee Data Change Approval & HR Service Requests routes (§29).
 *
 * THREE THINGS THIS FILE ENFORCES THAT NOTHING ELSE CAN.
 *
 * The ORIGIN of a data-change request is decided HERE, by which route was
 * called — never by the request body (§29.2). An ESS route always sets
 * `employee_self_service` and always derives the subject from the caller's own
 * employee link; an HR route always sets `hr_originated`. A client cannot claim
 * to be the other.
 *
 * The ORGANIZATION is never taken from the client. Every handler reads
 * `req.membership!.organizationId`, resolved by `requireMembership` from the
 * caller's own verified membership, so a forged `:organizationId` fails safely
 * rather than addressing another tenant's rows.
 *
 * AUTHORIZATION IS SERVER-SIDE ON EVERY ROUTE. Maker-checker (§29.6) is enforced
 * in the service beneath these handlers, so it holds even for a caller who
 * reaches the endpoint directly — frontend hiding is not authorization.
 */

const router = Router();

function mapDomainError(err: unknown, res: import("express").Response): boolean {
  if (
    err instanceof dataChange.DataChangeRequestNotFoundError ||
    err instanceof serviceRequests.ServiceRequestNotFoundError ||
    err instanceof serviceRequests.ServiceRequestTypeNotFoundError
  ) {
    res.status(404).json({ error: (err as Error).message });
    return true;
  }
  // Self-approval and missing authority are authorization failures, not
  // validation ones — 403 so a caller cannot mistake them for a bad payload.
  if (err instanceof dataChange.SelfApprovalForbiddenError || err instanceof dataChange.NotAnApproverError) {
    res.status(403).json({ error: (err as Error).message });
    return true;
  }
  if (err instanceof dataChange.DuplicatePendingFieldError) {
    res.status(409).json({ error: (err as Error).message });
    return true;
  }
  if (err instanceof dataChange.RequestStaleError) {
    // 409: the request's basis moved. Re-confirmation is the resolution.
    res.status(409).json({ error: (err as Error).message });
    return true;
  }
  if (
    err instanceof dataChange.InvalidDataChangeError ||
    err instanceof dataChange.RequestNotActionableError ||
    err instanceof serviceRequests.InvalidServiceRequestError ||
    err instanceof serviceRequests.ServiceRequestNotActionableError ||
    err instanceof stages.InvalidStageConfigError ||
    err instanceof UnknownEligibleFieldError ||
    err instanceof FieldNotEligibleForOriginError
  ) {
    res.status(422).json({ error: (err as Error).message });
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Eligible fields and policy (§29.3, §29.4)
// ---------------------------------------------------------------------------

/**
 * The registry plus this organization's effective policy.
 *
 * Note what is returned: only fields the PRODUCT allows. There is no endpoint
 * anywhere that lists employee columns, because §29.3's whole point is that
 * configuration can never introduce a target.
 */
router.get(
  "/organizations/:organizationId/data-change-fields",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("data_change.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const policies = await dataChange.resolveFieldPolicies(req.membership!.organizationId);
    res.json(
      policies.map((p) => ({
        fieldKey: p.field.key,
        label: p.field.label,
        kind: p.field.kind,
        essEligible: p.field.essEligible,
        hrEligible: p.field.hrEligible,
        sensitive: p.field.sensitive,
        approvalRequired: p.approvalRequired,
      })),
    );
  },
);

router.put(
  "/organizations/:organizationId/data-change-fields/:fieldKey",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("data_change.configure"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = SetDataChangeFieldPolicyBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const result = await dataChange.setFieldPolicy({
        organizationId: req.membership!.organizationId,
        // Validated against the registry inside the service — a key that is not
        // registered is refused, so configuration cannot invent a field.
        fieldKey: String(req.params["fieldKey"]),
        approvalRequired: parsed.data.approvalRequired,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json({ fieldKey: result.field.key, approvalRequired: result.approvalRequired });
    } catch (err) {
      if (!mapDomainError(err, res)) throw err;
    }
  },
);

// ---------------------------------------------------------------------------
// Approval stages (§29.8)
// ---------------------------------------------------------------------------

router.get(
  "/organizations/:organizationId/request-approval-stages",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("data_change.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const purpose = (req.query["purpose"] as stages.ApprovalPurpose) ?? "data_change";
    res.json(await stages.listStages(req.membership!.organizationId, purpose));
  },
);

router.post(
  "/organizations/:organizationId/request-approval-stages",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("data_change.configure"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = CreateRequestApprovalStageBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const created = await stages.createStage({
        organizationId: req.membership!.organizationId,
        purpose: parsed.data.purpose,
        stageOrder: parsed.data.stageOrder,
        name: parsed.data.name,
        resolverType: parsed.data.resolverType,
        resolverConfig: parsed.data.resolverConfig,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.status(201).json(created);
    } catch (err) {
      if (!mapDomainError(err, res)) throw err;
    }
  },
);

router.delete(
  "/organizations/:organizationId/request-approval-stages/:stageId",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("data_change.configure"),
  async (req: MembershipRequest, res): Promise<void> => {
    try {
      await stages.deleteStage({
        organizationId: req.membership!.organizationId,
        stageId: Number(req.params["stageId"]),
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.status(204).send();
    } catch (err) {
      if (!mapDomainError(err, res)) throw err;
    }
  },
);

// ---------------------------------------------------------------------------
// Data change — HR side (§29.2, §29.17)
// ---------------------------------------------------------------------------

router.get(
  "/organizations/:organizationId/data-change-requests",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("data_change.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const employeeId = req.query["employeeId"] ? Number(req.query["employeeId"]) : undefined;
    const status = req.query["status"] as never;
    res.json(await dataChange.listRequests(req.membership!.organizationId, { employeeId, status }));
  },
);

/**
 * The APPROVAL view (§29.7).
 *
 * Deliberately not the employee record. It carries the field, its previous and
 * requested values, and the decision context — nothing else — and sensitive
 * values arrive masked. Being an approver expands no visibility.
 */
router.get(
  "/organizations/:organizationId/data-change-requests/:requestId",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("data_change.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const organizationId = req.membership!.organizationId;
    const requestId = Number(req.params["requestId"]);
    const request = await dataChange.getRequest(organizationId, requestId);
    if (!request) {
      res.status(404).json({ error: "Data change request not found" });
      return;
    }
    const [fields, events] = await Promise.all([
      dataChange.listRequestFields(organizationId, requestId),
      dataChange.listRequestEvents(organizationId, requestId),
    ]);
    res.json({ ...dataChange.toApprovalView(request, fields), events });
  },
);

router.post(
  "/organizations/:organizationId/employees/:employeeId/data-change-requests",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("data_change.request"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = CreateDataChangeRequestBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const result = await dataChange.createRequest({
        organizationId: req.membership!.organizationId,
        employeeId: Number(req.params["employeeId"]),
        // Fixed by the route, not the body.
        origin: "hr_originated",
        fields: parsed.data.fields.map((f) => ({ fieldKey: f.fieldKey, requestedValue: f.requestedValue })),
        reason: parsed.data.reason ?? null,
        effectiveDate: parsed.data.effectiveDate ? new Date(parsed.data.effectiveDate) : null,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.status(201).json({ request: result.request, approvalRequired: result.approvalRequired });
    } catch (err) {
      if (!mapDomainError(err, res)) throw err;
    }
  },
);

router.post(
  "/organizations/:organizationId/data-change-requests/:requestId/approve",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("data_change.approve"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = DecideDataChangeRequestBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      // Maker-checker and stale detection both live in the service, so they
      // hold for any caller who reaches this endpoint.
      const updated = await dataChange.approve({
        organizationId: req.membership!.organizationId,
        requestId: Number(req.params["requestId"]),
        notes: parsed.data.notes ?? null,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(updated);
    } catch (err) {
      if (!mapDomainError(err, res)) throw err;
    }
  },
);

router.post(
  "/organizations/:organizationId/data-change-requests/:requestId/reject",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("data_change.approve"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = RejectDataChangeRequestBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const updated = await dataChange.reject({
        organizationId: req.membership!.organizationId,
        requestId: Number(req.params["requestId"]),
        reason: parsed.data.reason,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(updated);
    } catch (err) {
      if (!mapDomainError(err, res)) throw err;
    }
  },
);

router.post(
  "/organizations/:organizationId/data-change-requests/:requestId/return",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("data_change.approve"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = ReturnDataChangeRequestBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const updated = await dataChange.returnForInformation({
        organizationId: req.membership!.organizationId,
        requestId: Number(req.params["requestId"]),
        reason: parsed.data.reason,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(updated);
    } catch (err) {
      if (!mapDomainError(err, res)) throw err;
    }
  },
);

/** Audited re-confirmation of a stale request against the values as they now stand (§29.10). */
router.post(
  "/organizations/:organizationId/data-change-requests/:requestId/reconfirm",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("data_change.approve"),
  async (req: MembershipRequest, res): Promise<void> => {
    try {
      const updated = await dataChange.reconfirm({
        organizationId: req.membership!.organizationId,
        requestId: Number(req.params["requestId"]),
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(updated);
    } catch (err) {
      if (!mapDomainError(err, res)) throw err;
    }
  },
);

/**
 * Writes an approved change to the authoritative record.
 *
 * A separate, explicit human act — not a side effect of approval, and
 * deliberately unreachable from any scheduled job (§29.10, §29.11).
 */
router.post(
  "/organizations/:organizationId/data-change-requests/:requestId/apply",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("data_change.approve"),
  async (req: MembershipRequest, res): Promise<void> => {
    try {
      const updated = await dataChange.applyRequest({
        organizationId: req.membership!.organizationId,
        requestId: Number(req.params["requestId"]),
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(updated);
    } catch (err) {
      if (!mapDomainError(err, res)) throw err;
    }
  },
);

// ---------------------------------------------------------------------------
// Data change — Employee Self-Service (§29.2, §29.17)
// ---------------------------------------------------------------------------

/**
 * No permission key gates these (§29.18). An employee's right to ask about
 * their own record comes from their employee link, resolved server-side — a
 * right an administrator could withhold is not self-service.
 */
router.get(
  "/organizations/:organizationId/my-data-change-requests",
  requireAuth as any,
  requireMembership("organizationId"),
  async (req: MembershipRequest, res): Promise<void> => {
    const organizationId = req.membership!.organizationId;
    const employeeId = await resolveOwnEmployeeId(organizationId, req.userId!);
    if (!employeeId) {
      res.json([]);
      return;
    }
    const requests = await dataChange.listRequests(organizationId, { employeeId });
    const views = await Promise.all(
      requests.map(async (r) => dataChange.toEssView(r, await dataChange.listRequestFields(organizationId, r.id))),
    );
    res.json(views);
  },
);

router.post(
  "/organizations/:organizationId/my-data-change-requests",
  requireAuth as any,
  requireMembership("organizationId"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = SubmitMyDataChangeRequestBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const organizationId = req.membership!.organizationId;
    const employeeId = await resolveOwnEmployeeId(organizationId, req.userId!);
    if (!employeeId) {
      res.status(403).json({ error: "No employee record is linked to this account." });
      return;
    }
    try {
      const result = await dataChange.createRequest({
        organizationId,
        // Derived from the link. The body carries no employee identifier at all,
        // so a browser cannot claim authority over somebody else's record.
        employeeId,
        origin: "employee_self_service",
        fields: parsed.data.fields.map((f) => ({ fieldKey: f.fieldKey, requestedValue: f.requestedValue })),
        reason: parsed.data.reason ?? null,
        effectiveDate: parsed.data.effectiveDate ? new Date(parsed.data.effectiveDate) : null,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.status(201).json(dataChange.toEssView(result.request, result.fields));
    } catch (err) {
      if (!mapDomainError(err, res)) throw err;
    }
  },
);

router.post(
  "/organizations/:organizationId/my-data-change-requests/:requestId/withdraw",
  requireAuth as any,
  requireMembership("organizationId"),
  async (req: MembershipRequest, res): Promise<void> => {
    const organizationId = req.membership!.organizationId;
    const employeeId = await resolveOwnEmployeeId(organizationId, req.userId!);
    const request = await dataChange.getRequest(organizationId, Number(req.params["requestId"]));
    // Somebody else's request is reported as NOT FOUND rather than FORBIDDEN: a
    // 403 would confirm it exists, which is itself a disclosure.
    if (!request || !employeeId || request.employeeId !== employeeId) {
      res.status(404).json({ error: "Data change request not found" });
      return;
    }
    try {
      const updated = await dataChange.withdraw({
        organizationId,
        requestId: request.id,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(dataChange.toEssView(updated, await dataChange.listRequestFields(organizationId, updated.id)));
    } catch (err) {
      if (!mapDomainError(err, res)) throw err;
    }
  },
);

/** The eligible fields an employee may request on themselves, with current values. */
router.get(
  "/organizations/:organizationId/my-data-change-fields",
  requireAuth as any,
  requireMembership("organizationId"),
  async (req: MembershipRequest, res): Promise<void> => {
    const organizationId = req.membership!.organizationId;
    const employeeId = await resolveOwnEmployeeId(organizationId, req.userId!);
    if (!employeeId) {
      res.json([]);
      return;
    }
    const policies = await dataChange.resolveFieldPolicies(organizationId);
    res.json(
      policies
        .filter((p) => p.field.essEligible)
        .map((p) => ({
          fieldKey: p.field.key,
          label: p.field.label,
          kind: p.field.kind,
          sensitive: p.field.sensitive,
          approvalRequired: p.approvalRequired,
        })),
    );
  },
);

// ---------------------------------------------------------------------------
// Service request types (§29.12)
// ---------------------------------------------------------------------------

router.get(
  "/organizations/:organizationId/service-request-types",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("service_request.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    res.json(await serviceRequests.listTypes(req.membership!.organizationId));
  },
);

router.post(
  "/organizations/:organizationId/service-request-types",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("service_request.configure"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = CreateServiceRequestTypeBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const created = await serviceRequests.createType({
        organizationId: req.membership!.organizationId,
        code: parsed.data.code,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        employeeVisible: parsed.data.employeeVisible,
        approvalRequired: parsed.data.approvalRequired,
        fulfilmentKind: parsed.data.fulfilmentKind,
        formId: parsed.data.formId ?? null,
        responsibleDepartmentId: parsed.data.responsibleDepartmentId ?? null,
        targetDays: parsed.data.targetDays ?? null,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.status(201).json(created);
    } catch (err) {
      if (!mapDomainError(err, res)) throw err;
    }
  },
);

router.patch(
  "/organizations/:organizationId/service-request-types/:typeId",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("service_request.configure"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = UpdateServiceRequestTypeBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const updated = await serviceRequests.updateType({
        organizationId: req.membership!.organizationId,
        typeId: Number(req.params["typeId"]),
        ...parsed.data,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(updated);
    } catch (err) {
      if (!mapDomainError(err, res)) throw err;
    }
  },
);

// ---------------------------------------------------------------------------
// Service requests — HR side (§29.12, §29.17)
// ---------------------------------------------------------------------------

router.get(
  "/organizations/:organizationId/service-requests",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("service_request.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const employeeId = req.query["employeeId"] ? Number(req.query["employeeId"]) : undefined;
    const status = req.query["status"] as never;
    // `assignedToMe` powers the "Assigned Requests" surface without letting a
    // caller ask about somebody else's queue by id.
    const assignedMembershipId = req.query["assignedToMe"] === "true" ? req.membership!.id : undefined;
    res.json(
      await serviceRequests.listRequests(req.membership!.organizationId, { employeeId, status, assignedMembershipId }),
    );
  },
);

router.get(
  "/organizations/:organizationId/service-requests/:requestId",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("service_request.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const organizationId = req.membership!.organizationId;
    const requestId = Number(req.params["requestId"]);
    const request = await serviceRequests.getRequest(organizationId, requestId);
    if (!request) {
      res.status(404).json({ error: "Service request not found" });
      return;
    }
    res.json({ ...request, events: await serviceRequests.listEvents(organizationId, requestId) });
  },
);

router.post(
  "/organizations/:organizationId/employees/:employeeId/service-requests",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("service_request.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = CreateServiceRequestBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const created = await serviceRequests.submitRequest({
        organizationId: req.membership!.organizationId,
        typeId: parsed.data.typeId,
        employeeId: Number(req.params["employeeId"]),
        subject: parsed.data.subject,
        details: parsed.data.details ?? null,
        formSubmissionId: parsed.data.formSubmissionId ?? null,
        evidenceDocumentId: parsed.data.evidenceDocumentId ?? null,
        viaSelfService: false,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.status(201).json(created);
    } catch (err) {
      if (!mapDomainError(err, res)) throw err;
    }
  },
);

const serviceAction = (
  path: string,
  permission: string,
  handler: (req: MembershipRequest, res: import("express").Response) => Promise<void>,
) => {
  router.post(
    `/organizations/:organizationId/service-requests/:requestId/${path}`,
    requireAuth as any,
    requireMembership("organizationId"),
    requirePermission(permission),
    async (req: MembershipRequest, res): Promise<void> => {
      try {
        await handler(req, res);
      } catch (err) {
        if (!mapDomainError(err, res)) throw err;
      }
    },
  );
};

serviceAction("acknowledge", "service_request.manage", async (req, res) => {
  const parsed = AcknowledgeServiceRequestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  res.json(
    await serviceRequests.acknowledge({
      organizationId: req.membership!.organizationId,
      requestId: Number(req.params["requestId"]),
      notes: parsed.data.notes ?? null,
      actorApplicationUserId: req.userId!,
      actorMembershipId: req.membership!.id,
    }),
  );
});

serviceAction("assign", "service_request.manage", async (req, res) => {
  const parsed = AssignServiceRequestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  res.json(
    await serviceRequests.assign({
      organizationId: req.membership!.organizationId,
      requestId: Number(req.params["requestId"]),
      assignedMembershipId: parsed.data.assignedMembershipId,
      actorApplicationUserId: req.userId!,
      actorMembershipId: req.membership!.id,
    }),
  );
});

serviceAction("approve", "service_request.approve", async (req, res) => {
  const parsed = ApproveServiceRequestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  res.json(
    await serviceRequests.approve({
      organizationId: req.membership!.organizationId,
      requestId: Number(req.params["requestId"]),
      notes: parsed.data.notes ?? null,
      actorApplicationUserId: req.userId!,
      actorMembershipId: req.membership!.id,
    }),
  );
});

serviceAction("reject", "service_request.approve", async (req, res) => {
  const parsed = RejectServiceRequestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  res.json(
    await serviceRequests.reject({
      organizationId: req.membership!.organizationId,
      requestId: Number(req.params["requestId"]),
      reason: parsed.data.reason,
      actorApplicationUserId: req.userId!,
      actorMembershipId: req.membership!.id,
    }),
  );
});

serviceAction("request-information", "service_request.manage", async (req, res) => {
  const parsed = RequestServiceRequestInformationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  res.json(
    await serviceRequests.requestInformation({
      organizationId: req.membership!.organizationId,
      requestId: Number(req.params["requestId"]),
      message: parsed.data.message,
      actorApplicationUserId: req.userId!,
      actorMembershipId: req.membership!.id,
    }),
  );
});

serviceAction("fulfil", "service_request.manage", async (req, res) => {
  const parsed = FulfilServiceRequestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  // WS-13 attaches the WS-5 document; it never generates one (§29.13).
  res.json(
    await serviceRequests.fulfil({
      organizationId: req.membership!.organizationId,
      requestId: Number(req.params["requestId"]),
      resolutionSummary: parsed.data.resolutionSummary,
      generatedDocumentId: parsed.data.generatedDocumentId ?? null,
      actorApplicationUserId: req.userId!,
      actorMembershipId: req.membership!.id,
    }),
  );
});

serviceAction("close", "service_request.manage", async (req, res) => {
  const parsed = CloseServiceRequestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  res.json(
    await serviceRequests.close({
      organizationId: req.membership!.organizationId,
      requestId: Number(req.params["requestId"]),
      notes: parsed.data.notes ?? null,
      actorApplicationUserId: req.userId!,
      actorMembershipId: req.membership!.id,
    }),
  );
});

// ---------------------------------------------------------------------------
// Service requests — Employee Self-Service (§29.17)
// ---------------------------------------------------------------------------

router.get(
  "/organizations/:organizationId/my-service-request-types",
  requireAuth as any,
  requireMembership("organizationId"),
  async (req: MembershipRequest, res): Promise<void> => {
    // Only active, employee-visible types. A type an organization has hidden
    // from ESS is not merely unlisted here — submitting it is refused too.
    res.json(
      await serviceRequests.listTypes(req.membership!.organizationId, {
        activeOnly: true,
        employeeVisibleOnly: true,
      }),
    );
  },
);

router.get(
  "/organizations/:organizationId/my-service-requests",
  requireAuth as any,
  requireMembership("organizationId"),
  async (req: MembershipRequest, res): Promise<void> => {
    const organizationId = req.membership!.organizationId;
    const employeeId = await resolveOwnEmployeeId(organizationId, req.userId!);
    if (!employeeId) {
      res.json([]);
      return;
    }
    const requests = await serviceRequests.listRequests(organizationId, { employeeId });
    const views = await Promise.all(
      requests.map(async (r) =>
        serviceRequests.toEssView(r, await serviceRequests.listEvents(organizationId, r.id, { onlyVisibleToEmployee: true })),
      ),
    );
    res.json(views);
  },
);

router.post(
  "/organizations/:organizationId/my-service-requests",
  requireAuth as any,
  requireMembership("organizationId"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = SubmitMyServiceRequestBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const organizationId = req.membership!.organizationId;
    const employeeId = await resolveOwnEmployeeId(organizationId, req.userId!);
    if (!employeeId) {
      res.status(403).json({ error: "No employee record is linked to this account." });
      return;
    }
    try {
      const created = await serviceRequests.submitRequest({
        organizationId,
        typeId: parsed.data.typeId,
        employeeId,
        subject: parsed.data.subject,
        details: parsed.data.details ?? null,
        formSubmissionId: parsed.data.formSubmissionId ?? null,
        evidenceDocumentId: parsed.data.evidenceDocumentId ?? null,
        viaSelfService: true,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.status(201).json(
        serviceRequests.toEssView(
          created,
          await serviceRequests.listEvents(organizationId, created.id, { onlyVisibleToEmployee: true }),
        ),
      );
    } catch (err) {
      if (!mapDomainError(err, res)) throw err;
    }
  },
);

const myServiceAction = (
  path: string,
  handler: (
    req: MembershipRequest,
    res: import("express").Response,
    ctx: { organizationId: number; requestId: number },
  ) => Promise<void>,
) => {
  router.post(
    `/organizations/:organizationId/my-service-requests/:requestId/${path}`,
    requireAuth as any,
    requireMembership("organizationId"),
    async (req: MembershipRequest, res): Promise<void> => {
      const organizationId = req.membership!.organizationId;
      const employeeId = await resolveOwnEmployeeId(organizationId, req.userId!);
      const request = await serviceRequests.getRequest(organizationId, Number(req.params["requestId"]));
      if (!request || !employeeId || request.employeeId !== employeeId) {
        res.status(404).json({ error: "Service request not found" });
        return;
      }
      try {
        await handler(req, res, { organizationId, requestId: request.id });
      } catch (err) {
        if (!mapDomainError(err, res)) throw err;
      }
    },
  );
};

myServiceAction("respond", async (req, res, ctx) => {
  const parsed = RespondToServiceRequestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const updated = await serviceRequests.respond({
    organizationId: ctx.organizationId,
    requestId: ctx.requestId,
    message: parsed.data.message,
    actorApplicationUserId: req.userId!,
    actorMembershipId: req.membership!.id,
  });
  res.json(
    serviceRequests.toEssView(
      updated,
      await serviceRequests.listEvents(ctx.organizationId, ctx.requestId, { onlyVisibleToEmployee: true }),
    ),
  );
});

myServiceAction("withdraw", async (req, res, ctx) => {
  const updated = await serviceRequests.withdraw({
    organizationId: ctx.organizationId,
    requestId: ctx.requestId,
    actorApplicationUserId: req.userId!,
    actorMembershipId: req.membership!.id,
  });
  res.json(
    serviceRequests.toEssView(
      updated,
      await serviceRequests.listEvents(ctx.organizationId, ctx.requestId, { onlyVisibleToEmployee: true }),
    ),
  );
});

// ---------------------------------------------------------------------------
// Reporting (§29.21)
// ---------------------------------------------------------------------------

/**
 * Counts and ageing only. No requested value, no previous value, no note —
 * a report must never be the route by which a value reaches a caller who could
 * not read the record itself.
 *
 * Gated on holding EITHER read permission, and each half is included only if
 * the caller may see that half — so a service-request reader does not learn how
 * many data changes are pending.
 */
router.get(
  "/organizations/:organizationId/requests/reports",
  requireAuth as any,
  requireMembership("organizationId"),
  async (req: MembershipRequest, res): Promise<void> => {
    const organizationId = req.membership!.organizationId;
    const membershipId = req.membership!.id;
    const [mayReadDataChange, mayReadService] = await Promise.all([
      hasPermission(membershipId, "data_change.read"),
      hasPermission(membershipId, "service_request.read"),
    ]);
    if (!mayReadDataChange && !mayReadService) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    res.json({
      pendingDataChanges: mayReadDataChange ? await dataChange.pendingRequests(organizationId) : null,
      openServiceRequests: mayReadService ? await serviceRequests.openRequests(organizationId) : null,
    });
  },
);

/** The registry itself, for surfaces that need labels without policy. */
router.get(
  "/organizations/:organizationId/data-change-field-registry",
  requireAuth as any,
  requireMembership("organizationId"),
  async (_req: MembershipRequest, res): Promise<void> => {
    res.json(
      ELIGIBLE_FIELDS.map((f) => ({ fieldKey: f.key, label: f.label, kind: f.kind, sensitive: f.sensitive })),
    );
  },
);

export default router;
