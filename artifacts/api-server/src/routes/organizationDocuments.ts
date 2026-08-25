/**
 * WS-5 (§9, §30-32, §35, §38) — the organization-level Documents & Records
 * API.
 *
 * Every route runs the standard chain: requireAuth -> requireMembership ->
 * requirePermission. requireMembership resolves the organization from the
 * path against the caller's own membership (or an active WS-4 break-glass
 * grant) — a client-supplied organization id is only ever a lookup key, so
 * no route below trusts it (§4/§30). Downloads then re-prove that the
 * requested version belongs to both the document and that organization
 * before a single byte is read from storage, which is what closes the
 * document/version IDOR paths in §54.
 *
 * Break-glass needs no special handling here (§31): because these routes use
 * the ordinary middleware, an elevated read works exactly when the grant's
 * scope includes the specific permission key, and recordAuditEvent tags the
 * resulting event with the grant id automatically. There is no bypass in
 * this file, by design.
 */
import { Router, type Response, type NextFunction } from "express";
import multer from "multer";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, resolveOrganizationId, resolveActorMembershipId, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import { hasPermission } from "../lib/permissions";
import { readOrgFile } from "../lib/fileStorage";
import { InvalidDocumentError } from "../lib/documentValidation";
import {
  listDocuments,
  getDocument,
  listVersions,
  getVersion,
  createDocument,
  addVersion,
  updateDocumentMetadata,
  auditDocumentRead,
  OrganizationDocumentNotFoundError,
  DocumentArchivedError,
  VersionConflictError,
} from "../lib/organizationDocuments";
import { listCategories, getCategoryBehavior, upsertCategorySettings, UnknownDocumentCategoryError } from "../lib/documentCategories";

const router = Router();

// Same 10MB outer bound as every other upload route in this codebase;
// validateDocumentUpload re-checks it from the real bytes.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

/**
 * multer surfaces its own errors through Express's error path, which would
 * otherwise render an oversized upload as a 500 — same wrapper, same reason,
 * as routes/performanceReviewEvidence.ts.
 */
function handleUpload(req: MembershipRequest, res: Response, next: NextFunction): void {
  upload.single("file")(req as never, res as never, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      res.status(400).json({ error: err.code === "LIMIT_FILE_SIZE" ? "File exceeds the 10MB size limit" : err.message });
      return;
    }
    if (err) {
      next(err);
      return;
    }
    next();
  });
}

function parseId(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(value ?? "", 10);
}

function handleError(err: unknown, res: Response): void {
  if (err instanceof OrganizationDocumentNotFoundError) {
    res.status(404).json({ error: err.message });
    return;
  }
  if (err instanceof UnknownDocumentCategoryError || err instanceof InvalidDocumentError) {
    res.status(400).json({ error: err.message });
    return;
  }
  if (err instanceof DocumentArchivedError) {
    res.status(409).json({ error: err.message });
    return;
  }
  if (err instanceof VersionConflictError) {
    res.status(409).json({ error: err.message });
    return;
  }
  throw err;
}

function formatDocument(row: Awaited<ReturnType<typeof listDocuments>>[number]) {
  return {
    id: row.document.id,
    organizationId: row.document.organizationId,
    categoryCode: row.document.categoryCode,
    title: row.document.title,
    description: row.document.description,
    status: row.document.status,
    currentVersionId: row.document.currentVersionId,
    createdBy: row.document.createdBy,
    createdAt: row.document.createdAt,
    updatedAt: row.document.updatedAt,
    currentVersion: row.currentVersion
      ? {
          id: row.currentVersion.id,
          versionNumber: row.currentVersion.versionNumber,
          fileName: row.currentVersion.fileName,
          mimeType: row.currentVersion.mimeType,
          fileSize: row.currentVersion.fileSize,
          effectiveDate: row.currentVersion.effectiveDate,
          expiryDate: row.currentVersion.expiryDate,
          createdAt: row.currentVersion.createdAt,
        }
      : null,
  };
}

// GET /organizations/:organizationId/documents/categories
router.get(
  "/organizations/:organizationId/documents/categories",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("organization_document.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    res.json(await listCategories(resolveOrganizationId(req)));
  },
);

// PUT /organizations/:organizationId/documents/categories/:categoryCode
router.put(
  "/organizations/:organizationId/documents/categories/:categoryCode",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("organization_document.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const categoryCode = Array.isArray(req.params.categoryCode) ? req.params.categoryCode[0] : req.params.categoryCode;
    try {
      const row = await upsertCategorySettings({
        organizationId: resolveOrganizationId(req),
        categoryCode,
        verificationRequired: req.body?.verificationRequired,
        expirySupported: req.body?.expirySupported,
        expiryRequired: req.body?.expiryRequired,
        sensitivity: req.body?.sensitivity,
        retentionBasis: req.body?.retentionBasis,
        retentionPeriodMonths: req.body?.retentionPeriodMonths,
        actorApplicationUserId: req.userId!,
        actorMembershipId: resolveActorMembershipId(req),
      });
      res.json(row);
    } catch (err) {
      handleError(err, res);
    }
  },
);

// GET /organizations/:organizationId/documents
router.get(
  "/organizations/:organizationId/documents",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("organization_document.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const rows = await listDocuments(resolveOrganizationId(req), {
      categoryCode: typeof req.query.categoryCode === "string" ? req.query.categoryCode : undefined,
      status: req.query.status === "archived" ? "archived" : req.query.status === "active" ? "active" : undefined,
      search: typeof req.query.search === "string" ? req.query.search : undefined,
      expiringBefore: typeof req.query.expiringBefore === "string" ? req.query.expiringBefore : undefined,
    });
    res.json(rows.map(formatDocument));
  },
);

// POST /organizations/:organizationId/documents
router.post(
  "/organizations/:organizationId/documents",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("organization_document.manage"),
  handleUpload,
  async (req: MembershipRequest, res): Promise<void> => {
    const categoryCode = typeof req.body?.categoryCode === "string" ? req.body.categoryCode.trim() : "";
    const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
    if (!req.file || !categoryCode || !title) {
      res.status(400).json({ error: "categoryCode, title, and file are required" });
      return;
    }

    try {
      const result = await createDocument({
        organizationId: resolveOrganizationId(req),
        categoryCode,
        title,
        description: req.body?.description ?? null,
        effectiveDate: req.body?.effectiveDate || null,
        expiryDate: req.body?.expiryDate || null,
        file: {
          mimetype: req.file.mimetype,
          size: req.file.size,
          buffer: req.file.buffer,
          originalname: req.file.originalname,
        },
        actorApplicationUserId: req.userId!,
        actorMembershipId: resolveActorMembershipId(req),
      });
      res.status(201).json({ ...result.document, currentVersion: result.version });
    } catch (err) {
      handleError(err, res);
    }
  },
);

// GET /organizations/:organizationId/documents/:documentId
router.get(
  "/organizations/:organizationId/documents/:documentId",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("organization_document.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const documentId = parseId(req.params.documentId);
    if (isNaN(documentId)) {
      res.status(400).json({ error: "Invalid document ID" });
      return;
    }
    const document = await getDocument(resolveOrganizationId(req), documentId);
    if (!document) {
      res.status(404).json({ error: "Document not found" });
      return;
    }
    res.json(document);
  },
);

// PATCH /organizations/:organizationId/documents/:documentId
router.patch(
  "/organizations/:organizationId/documents/:documentId",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("organization_document.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const documentId = parseId(req.params.documentId);
    if (isNaN(documentId)) {
      res.status(400).json({ error: "Invalid document ID" });
      return;
    }
    try {
      const row = await updateDocumentMetadata({
        organizationId: resolveOrganizationId(req),
        documentId,
        title: typeof req.body?.title === "string" ? req.body.title.trim() : undefined,
        description: req.body?.description,
        actorApplicationUserId: req.userId!,
        actorMembershipId: resolveActorMembershipId(req),
      });
      res.json(row);
    } catch (err) {
      handleError(err, res);
    }
  },
);

// GET /organizations/:organizationId/documents/:documentId/versions
router.get(
  "/organizations/:organizationId/documents/:documentId/versions",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("organization_document.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const documentId = parseId(req.params.documentId);
    if (isNaN(documentId)) {
      res.status(400).json({ error: "Invalid document ID" });
      return;
    }
    const organizationId = resolveOrganizationId(req);
    // Prove the document itself is visible before listing anything about it,
    // so version history can't confirm the existence of another org's row.
    if (!(await getDocument(organizationId, documentId))) {
      res.status(404).json({ error: "Document not found" });
      return;
    }
    res.json(await listVersions(organizationId, documentId));
  },
);

// POST /organizations/:organizationId/documents/:documentId/versions
router.post(
  "/organizations/:organizationId/documents/:documentId/versions",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("organization_document.manage"),
  handleUpload,
  async (req: MembershipRequest, res): Promise<void> => {
    const documentId = parseId(req.params.documentId);
    if (isNaN(documentId) || !req.file) {
      res.status(400).json({ error: "A file is required" });
      return;
    }
    try {
      const version = await addVersion({
        organizationId: resolveOrganizationId(req),
        documentId,
        file: {
          mimetype: req.file.mimetype,
          size: req.file.size,
          buffer: req.file.buffer,
          originalname: req.file.originalname,
        },
        effectiveDate: req.body?.effectiveDate || null,
        expiryDate: req.body?.expiryDate || null,
        changeNote: req.body?.changeNote ?? null,
        actorApplicationUserId: req.userId!,
        actorMembershipId: resolveActorMembershipId(req),
      });
      res.status(201).json(version);
    } catch (err) {
      handleError(err, res);
    }
  },
);

// GET /organizations/:organizationId/documents/:documentId/versions/:versionId/download
//
// The authorization ladder, in order, before any storage read: authenticate
// -> membership (or break-glass) -> organization_document.read -> the
// document belongs to this organization -> the version belongs to that
// document -> if its category is confidential, the caller additionally holds
// organization_document.sensitive.read -> audit the read -> stream.
router.get(
  "/organizations/:organizationId/documents/:documentId/versions/:versionId/download",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("organization_document.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const documentId = parseId(req.params.documentId);
    const versionId = parseId(req.params.versionId);
    if (isNaN(documentId) || isNaN(versionId)) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }

    const organizationId = resolveOrganizationId(req);
    const document = await getDocument(organizationId, documentId);
    if (!document) {
      res.status(404).json({ error: "Document not found" });
      return;
    }

    const version = await getVersion(organizationId, documentId, versionId);
    if (!version) {
      res.status(404).json({ error: "Document version not found" });
      return;
    }

    const behavior = await getCategoryBehavior(organizationId, document.categoryCode);
    if (behavior.sensitivity === "confidential") {
      // Under break-glass there is no membership row to check against, so
      // the grant's own scope decides — the same rule requirePermission
      // applies, reused here for the second, finer gate.
      const allowed = req.membership
        ? await hasPermission(req.membership.id, "organization_document.sensitive.read")
        : (req.breakGlassGrant?.scope.includes("organization_document.sensitive.read") ?? false);
      if (!allowed) {
        res.status(403).json({ error: "Not authorized to read confidential documents" });
        return;
      }
    }

    await auditDocumentRead({
      organizationId,
      documentId,
      version,
      categoryCode: document.categoryCode,
      sensitivity: behavior.sensitivity,
      actorApplicationUserId: req.userId!,
      actorMembershipId: resolveActorMembershipId(req),
    });

    const buffer = await readOrgFile(organizationId, version.storageKey);
    res.set("Content-Type", version.mimeType || "application/octet-stream");
    res.set("Content-Disposition", `attachment; filename="${encodeURIComponent(version.fileName)}"`);
    res.set("Cache-Control", "private, no-store");
    res.send(buffer);
  },
);

export default router;
