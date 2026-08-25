/**
 * WS-5 (§12-17, §44-46) — the shared requirement/verification checklist and
 * the retention/legal-hold/disposal surface.
 *
 * Two permission boundaries the frozen scope draws explicitly, honored here:
 *
 *   Verification is not upload (§13). Recording that a document arrived
 *   needs organization_document.manage; deciding it is acceptable needs
 *   document.verify, a separate key.
 *
 *   Disposal is not management (§15-17). Archive, legal hold, and disposal
 *   all sit behind document.retention.manage, which is seeded to no role by
 *   default — authorizing destruction of records is a deliberate
 *   per-organization delegation, not something HR authority implies.
 *
 * Nothing here disposes anything automatically. The two query endpoints
 * report candidates; every state change is an individually authorized,
 * audited act by a named human.
 */
import { Router, type Response } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, resolveOrganizationId, resolveActorMembershipId, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import {
  createRequirement,
  listRequirements,
  markProvided,
  verifyRequirement,
  queryExpiryState,
  DocumentRequirementNotFoundError,
  DuplicateRequirementError,
  ExpiryDateRequiredError,
  ExpiryNotSupportedError,
  type RequirementOwnerType,
} from "../lib/documentRequirements";
import {
  archiveDocument,
  setLegalHold,
  markDisposalEligible,
  executeDisposal,
  listRetentionRecords,
  listDisposalEligible,
  getRetentionRecord,
  RetentionRecordNotFoundError,
  LegalHoldActiveError,
  AlreadyDisposedError,
  RetentionNotExpiredError,
  UnknownDocumentTableError,
} from "../lib/documentRetention";
import { UnknownDocumentCategoryError } from "../lib/documentCategories";

const router = Router();

function parseId(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(value ?? "", 10);
}

const OWNER_TYPES: readonly RequirementOwnerType[] = ["employee", "candidate", "organization"];

function handleError(err: unknown, res: Response): void {
  if (err instanceof DocumentRequirementNotFoundError || err instanceof RetentionRecordNotFoundError) {
    res.status(404).json({ error: err.message });
    return;
  }
  if (
    err instanceof UnknownDocumentCategoryError ||
    err instanceof UnknownDocumentTableError ||
    err instanceof ExpiryDateRequiredError ||
    err instanceof ExpiryNotSupportedError
  ) {
    res.status(400).json({ error: err.message });
    return;
  }
  if (err instanceof DuplicateRequirementError) {
    res.status(409).json({ error: err.message });
    return;
  }
  // Legal hold and an unexpired retention period are refusals to act, not
  // malformed requests — 409 so a caller can distinguish "not allowed yet"
  // from "you asked wrongly".
  if (err instanceof LegalHoldActiveError || err instanceof AlreadyDisposedError || err instanceof RetentionNotExpiredError) {
    res.status(409).json({ error: err.message });
    return;
  }
  throw err;
}

// GET /organizations/:organizationId/document-requirements
router.get(
  "/organizations/:organizationId/document-requirements",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("organization_document.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const ownerType = typeof req.query.ownerType === "string" ? req.query.ownerType : undefined;
    res.json(
      await listRequirements(resolveOrganizationId(req), {
        ownerType: OWNER_TYPES.includes(ownerType as RequirementOwnerType) ? (ownerType as RequirementOwnerType) : undefined,
        ownerId: typeof req.query.ownerId === "string" ? parseInt(req.query.ownerId, 10) : undefined,
      }),
    );
  },
);

// POST /organizations/:organizationId/document-requirements
router.post(
  "/organizations/:organizationId/document-requirements",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("organization_document.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const ownerType = req.body?.ownerType;
    const ownerId = req.body?.ownerId != null ? parseId(String(req.body.ownerId)) : NaN;
    const categoryCode = typeof req.body?.categoryCode === "string" ? req.body.categoryCode.trim() : "";
    if (!OWNER_TYPES.includes(ownerType) || isNaN(ownerId) || !categoryCode) {
      res.status(400).json({ error: "ownerType, ownerId, and categoryCode are required" });
      return;
    }
    try {
      res.status(201).json(
        await createRequirement({
          organizationId: resolveOrganizationId(req),
          ownerType,
          ownerId,
          categoryCode,
          required: req.body?.required,
          notes: req.body?.notes ?? null,
          actorApplicationUserId: req.userId!,
          actorMembershipId: resolveActorMembershipId(req),
        }),
      );
    } catch (err) {
      handleError(err, res);
    }
  },
);

// POST .../document-requirements/:requirementId/provide
router.post(
  "/organizations/:organizationId/document-requirements/:requirementId/provide",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("organization_document.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const requirementId = parseId(req.params.requirementId);
    const fulfilledDocumentTable = typeof req.body?.fulfilledDocumentTable === "string" ? req.body.fulfilledDocumentTable : "";
    const fulfilledDocumentId = req.body?.fulfilledDocumentId != null ? parseId(String(req.body.fulfilledDocumentId)) : NaN;
    if (isNaN(requirementId) || !fulfilledDocumentTable || isNaN(fulfilledDocumentId)) {
      res.status(400).json({ error: "fulfilledDocumentTable and fulfilledDocumentId are required" });
      return;
    }
    try {
      res.json(
        await markProvided({
          organizationId: resolveOrganizationId(req),
          requirementId,
          fulfilledDocumentTable,
          fulfilledDocumentId,
          expiryDate: req.body?.expiryDate || null,
          actorApplicationUserId: req.userId!,
          actorMembershipId: resolveActorMembershipId(req),
        }),
      );
    } catch (err) {
      handleError(err, res);
    }
  },
);

// POST .../document-requirements/:requirementId/verify — document.verify only.
router.post(
  "/organizations/:organizationId/document-requirements/:requirementId/verify",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("document.verify"),
  async (req: MembershipRequest, res): Promise<void> => {
    const requirementId = parseId(req.params.requirementId);
    const approved = req.body?.approved;
    if (isNaN(requirementId) || typeof approved !== "boolean") {
      res.status(400).json({ error: "approved (boolean) is required" });
      return;
    }
    try {
      res.json(
        await verifyRequirement({
          organizationId: resolveOrganizationId(req),
          requirementId,
          approved,
          rejectionReason: req.body?.rejectionReason ?? null,
          actorApplicationUserId: req.userId!,
          actorMembershipId: resolveActorMembershipId(req),
        }),
      );
    } catch (err) {
      handleError(err, res);
    }
  },
);

// GET /organizations/:organizationId/document-requirements/expiry
// §44's WS-6 contract: reports only, sends nothing.
router.get(
  "/organizations/:organizationId/document-requirements/expiry",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("organization_document.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const asOf = typeof req.query.asOf === "string" ? req.query.asOf : new Date().toISOString().slice(0, 10);
    const horizonDays = typeof req.query.horizonDays === "string" ? parseInt(req.query.horizonDays, 10) : 30;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || isNaN(horizonDays)) {
      res.status(400).json({ error: "asOf must be YYYY-MM-DD and horizonDays a number" });
      return;
    }
    res.json(await queryExpiryState(resolveOrganizationId(req), asOf, horizonDays));
  },
);

// GET /organizations/:organizationId/document-retention
router.get(
  "/organizations/:organizationId/document-retention",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("organization_document.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    res.json(
      await listRetentionRecords(resolveOrganizationId(req), {
        archiveStatus: req.query.archiveStatus === "archived" ? "archived" : req.query.archiveStatus === "active" ? "active" : undefined,
        disposalStatus:
          req.query.disposalStatus === "eligible"
            ? "eligible"
            : req.query.disposalStatus === "disposed"
              ? "disposed"
              : req.query.disposalStatus === "none"
                ? "none"
                : undefined,
        legalHold: req.query.legalHold === "true" ? true : req.query.legalHold === "false" ? false : undefined,
      }),
    );
  },
);

// GET /organizations/:organizationId/document-retention/disposal-eligible
router.get(
  "/organizations/:organizationId/document-retention/disposal-eligible",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("organization_document.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const asOf = typeof req.query.asOf === "string" ? req.query.asOf : new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
      res.status(400).json({ error: "asOf must be YYYY-MM-DD" });
      return;
    }
    res.json(await listDisposalEligible(resolveOrganizationId(req), asOf));
  },
);

// GET .../document-retention/:documentTable/:documentId
router.get(
  "/organizations/:organizationId/document-retention/:documentTable/:documentId",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("organization_document.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const documentTable = Array.isArray(req.params.documentTable) ? req.params.documentTable[0] : req.params.documentTable;
    const documentId = parseId(req.params.documentId);
    if (isNaN(documentId)) {
      res.status(400).json({ error: "Invalid document ID" });
      return;
    }
    try {
      const record = await getRetentionRecord(resolveOrganizationId(req), documentTable, documentId);
      if (!record) {
        res.status(404).json({ error: "Retention record not found" });
        return;
      }
      res.json(record);
    } catch (err) {
      handleError(err, res);
    }
  },
);

/** Shared shape for the four retention state-change routes below. */
function retentionTarget(req: MembershipRequest): { documentTable: string; documentId: number } {
  const documentTable = Array.isArray(req.params.documentTable) ? req.params.documentTable[0] : req.params.documentTable;
  return { documentTable, documentId: parseId(req.params.documentId) };
}

// POST .../document-retention/:documentTable/:documentId/archive
router.post(
  "/organizations/:organizationId/document-retention/:documentTable/:documentId/archive",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("document.retention.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const { documentTable, documentId } = retentionTarget(req);
    if (isNaN(documentId)) {
      res.status(400).json({ error: "Invalid document ID" });
      return;
    }
    try {
      res.json(
        await archiveDocument({
          organizationId: resolveOrganizationId(req),
          documentTable,
          documentId,
          actorApplicationUserId: req.userId!,
          actorMembershipId: resolveActorMembershipId(req),
        }),
      );
    } catch (err) {
      handleError(err, res);
    }
  },
);

// PUT .../document-retention/:documentTable/:documentId/legal-hold
router.put(
  "/organizations/:organizationId/document-retention/:documentTable/:documentId/legal-hold",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("document.retention.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const { documentTable, documentId } = retentionTarget(req);
    const legalHold = req.body?.legalHold;
    if (isNaN(documentId) || typeof legalHold !== "boolean") {
      res.status(400).json({ error: "legalHold (boolean) is required" });
      return;
    }
    try {
      res.json(
        await setLegalHold({
          organizationId: resolveOrganizationId(req),
          documentTable,
          documentId,
          legalHold,
          reason: req.body?.reason ?? null,
          actorApplicationUserId: req.userId!,
          actorMembershipId: resolveActorMembershipId(req),
        }),
      );
    } catch (err) {
      handleError(err, res);
    }
  },
);

// POST .../document-retention/:documentTable/:documentId/disposal-eligibility
router.post(
  "/organizations/:organizationId/document-retention/:documentTable/:documentId/disposal-eligibility",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("document.retention.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const { documentTable, documentId } = retentionTarget(req);
    if (isNaN(documentId)) {
      res.status(400).json({ error: "Invalid document ID" });
      return;
    }
    try {
      res.json(
        await markDisposalEligible({
          organizationId: resolveOrganizationId(req),
          documentTable,
          documentId,
          actorApplicationUserId: req.userId!,
          actorMembershipId: resolveActorMembershipId(req),
        }),
      );
    } catch (err) {
      handleError(err, res);
    }
  },
);

// POST .../document-retention/:documentTable/:documentId/dispose
// The irreversible act — requires an explicit reason, which is audited.
router.post(
  "/organizations/:organizationId/document-retention/:documentTable/:documentId/dispose",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("document.retention.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const { documentTable, documentId } = retentionTarget(req);
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
    if (isNaN(documentId) || !reason) {
      res.status(400).json({ error: "A disposal reason is required" });
      return;
    }
    try {
      const result = await executeDisposal({
        organizationId: resolveOrganizationId(req),
        documentTable,
        documentId,
        reason,
        actorApplicationUserId: req.userId!,
        actorMembershipId: resolveActorMembershipId(req),
      });
      res.json({ ...result.record, storageDeleted: result.storageDeleted });
    } catch (err) {
      handleError(err, res);
    }
  },
);

export default router;
