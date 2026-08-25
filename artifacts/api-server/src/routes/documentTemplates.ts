/**
 * WS-5 (§19-22, §36, §40-42) — document template management and the
 * generation endpoint.
 *
 * Generation authorization (§40) is the notable part: producing an official
 * letter requires document_template.read *and* the caller must be able to
 * see the source entity, which is proved by resolving that entity inside the
 * caller's own organization rather than trusting an id. A template from Org
 * A therefore cannot render for an employee in Org B, because the employee
 * lookup is organization-scoped and simply finds nothing.
 */
import { Router, type Response } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, resolveOrganizationId, resolveActorMembershipId, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import { readOrgFile } from "../lib/fileStorage";
import { MERGE_FIELDS, UnknownMergeFieldError } from "../lib/documentMerge";
import {
  listTemplates,
  getTemplate,
  listTemplateVersions,
  getTemplateVersion,
  createTemplate,
  createVersion,
  updateDraftVersion,
  activateVersion,
  setTemplateStatus,
  DocumentTemplateNotFoundError,
  DocumentTemplateVersionNotFoundError,
  TemplateVersionImmutableError,
  TemplateActivationConflictError,
  NoActiveTemplateVersionError,
} from "../lib/documentTemplates";
import {
  generateDocument,
  previewTemplateVersion,
  buildEmployeeContext,
  listGeneratedDocuments,
  getGeneratedDocument,
  EmployeeNotFoundForGenerationError,
} from "../lib/documentGeneration";
import { UnknownDocumentCategoryError } from "../lib/documentCategories";

const router = Router();

function parseId(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(value ?? "", 10);
}

function handleError(err: unknown, res: Response): void {
  if (err instanceof DocumentTemplateNotFoundError || err instanceof DocumentTemplateVersionNotFoundError) {
    res.status(404).json({ error: err.message });
    return;
  }
  if (err instanceof EmployeeNotFoundForGenerationError) {
    res.status(404).json({ error: err.message });
    return;
  }
  if (err instanceof UnknownMergeFieldError || err instanceof UnknownDocumentCategoryError) {
    res.status(400).json({ error: err.message });
    return;
  }
  if (
    err instanceof TemplateVersionImmutableError ||
    err instanceof TemplateActivationConflictError ||
    err instanceof NoActiveTemplateVersionError
  ) {
    res.status(409).json({ error: err.message });
    return;
  }
  throw err;
}

// GET /organizations/:organizationId/document-templates/merge-fields
// The allow-list itself, so the template editor can offer exactly the fields
// that will actually resolve.
router.get(
  "/organizations/:organizationId/document-templates/merge-fields",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("document_template.read"),
  async (_req: MembershipRequest, res): Promise<void> => {
    res.json(MERGE_FIELDS);
  },
);

// GET /organizations/:organizationId/document-templates
router.get(
  "/organizations/:organizationId/document-templates",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("document_template.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    res.json(
      await listTemplates(resolveOrganizationId(req), {
        categoryCode: typeof req.query.categoryCode === "string" ? req.query.categoryCode : undefined,
        status: req.query.status === "inactive" ? "inactive" : req.query.status === "active" ? "active" : undefined,
      }),
    );
  },
);

// POST /organizations/:organizationId/document-templates
router.post(
  "/organizations/:organizationId/document-templates",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("document_template.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    const categoryCode = typeof req.body?.categoryCode === "string" ? req.body.categoryCode.trim() : "";
    const content = typeof req.body?.content === "string" ? req.body.content : "";
    if (!name || !categoryCode || !content) {
      res.status(400).json({ error: "name, categoryCode, and content are required" });
      return;
    }
    try {
      const result = await createTemplate({
        organizationId: resolveOrganizationId(req),
        categoryCode,
        name,
        description: req.body?.description ?? null,
        content,
        actorApplicationUserId: req.userId!,
        actorMembershipId: resolveActorMembershipId(req),
      });
      res.status(201).json({ ...result.template, currentVersion: result.version });
    } catch (err) {
      handleError(err, res);
    }
  },
);

// GET /organizations/:organizationId/document-templates/:templateId
router.get(
  "/organizations/:organizationId/document-templates/:templateId",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("document_template.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const templateId = parseId(req.params.templateId);
    if (isNaN(templateId)) {
      res.status(400).json({ error: "Invalid template ID" });
      return;
    }
    const template = await getTemplate(resolveOrganizationId(req), templateId);
    if (!template) {
      res.status(404).json({ error: "Template not found" });
      return;
    }
    res.json(template);
  },
);

// PATCH /organizations/:organizationId/document-templates/:templateId
router.patch(
  "/organizations/:organizationId/document-templates/:templateId",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("document_template.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const templateId = parseId(req.params.templateId);
    const status = req.body?.status;
    if (isNaN(templateId) || (status !== "active" && status !== "inactive")) {
      res.status(400).json({ error: "status must be active or inactive" });
      return;
    }
    try {
      res.json(
        await setTemplateStatus({
          organizationId: resolveOrganizationId(req),
          templateId,
          status,
          actorApplicationUserId: req.userId!,
          actorMembershipId: resolveActorMembershipId(req),
        }),
      );
    } catch (err) {
      handleError(err, res);
    }
  },
);

// GET /organizations/:organizationId/document-templates/:templateId/versions
router.get(
  "/organizations/:organizationId/document-templates/:templateId/versions",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("document_template.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const templateId = parseId(req.params.templateId);
    if (isNaN(templateId)) {
      res.status(400).json({ error: "Invalid template ID" });
      return;
    }
    const organizationId = resolveOrganizationId(req);
    if (!(await getTemplate(organizationId, templateId))) {
      res.status(404).json({ error: "Template not found" });
      return;
    }
    res.json(await listTemplateVersions(organizationId, templateId));
  },
);

// POST /organizations/:organizationId/document-templates/:templateId/versions
router.post(
  "/organizations/:organizationId/document-templates/:templateId/versions",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("document_template.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const templateId = parseId(req.params.templateId);
    const content = typeof req.body?.content === "string" ? req.body.content : "";
    if (isNaN(templateId) || !content) {
      res.status(400).json({ error: "content is required" });
      return;
    }
    try {
      res.status(201).json(
        await createVersion({
          organizationId: resolveOrganizationId(req),
          templateId,
          content,
          actorApplicationUserId: req.userId!,
          actorMembershipId: resolveActorMembershipId(req),
        }),
      );
    } catch (err) {
      handleError(err, res);
    }
  },
);

// PATCH .../versions/:versionId — draft only; an active version is immutable.
router.patch(
  "/organizations/:organizationId/document-templates/:templateId/versions/:versionId",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("document_template.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const templateId = parseId(req.params.templateId);
    const versionId = parseId(req.params.versionId);
    const content = typeof req.body?.content === "string" ? req.body.content : "";
    if (isNaN(templateId) || isNaN(versionId) || !content) {
      res.status(400).json({ error: "content is required" });
      return;
    }
    try {
      res.json(
        await updateDraftVersion({
          organizationId: resolveOrganizationId(req),
          templateId,
          versionId,
          content,
          actorApplicationUserId: req.userId!,
          actorMembershipId: resolveActorMembershipId(req),
        }),
      );
    } catch (err) {
      handleError(err, res);
    }
  },
);

// POST .../versions/:versionId/activate
router.post(
  "/organizations/:organizationId/document-templates/:templateId/versions/:versionId/activate",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("document_template.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const templateId = parseId(req.params.templateId);
    const versionId = parseId(req.params.versionId);
    if (isNaN(templateId) || isNaN(versionId)) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    try {
      res.json(
        await activateVersion({
          organizationId: resolveOrganizationId(req),
          templateId,
          versionId,
          actorApplicationUserId: req.userId!,
          actorMembershipId: resolveActorMembershipId(req),
        }),
      );
    } catch (err) {
      handleError(err, res);
    }
  },
);

// POST .../versions/:versionId/preview — synthetic sample data only (§42).
router.post(
  "/organizations/:organizationId/document-templates/:templateId/versions/:versionId/preview",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("document_template.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const templateId = parseId(req.params.templateId);
    const versionId = parseId(req.params.versionId);
    if (isNaN(templateId) || isNaN(versionId)) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    const organizationId = resolveOrganizationId(req);
    const version = await getTemplateVersion(organizationId, templateId, versionId);
    if (!version) {
      res.status(404).json({ error: "Template version not found" });
      return;
    }
    res.json(await previewTemplateVersion({ organizationId, templateVersion: version }));
  },
);

// POST /organizations/:organizationId/document-templates/:templateId/generate
//
// Produces a real, stored artifact from the template's ACTIVE version. The
// merge context is built server-side from the resolved employee record —
// never from request-body values — so the caller cannot inject another
// person's details, and the organization-scoped lookup is what makes
// cross-organization generation impossible (§40).
router.post(
  "/organizations/:organizationId/document-templates/:templateId/generate",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("document_template.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const templateId = parseId(req.params.templateId);
    const employeeId = req.body?.employeeId != null ? parseId(String(req.body.employeeId)) : NaN;
    if (isNaN(templateId) || isNaN(employeeId)) {
      res.status(400).json({ error: "templateId and employeeId are required" });
      return;
    }

    const organizationId = resolveOrganizationId(req);
    try {
      const entityContext = await buildEmployeeContext(organizationId, employeeId);
      const result = await generateDocument({
        organizationId,
        templateId,
        entityContext,
        sourceType: "employee",
        sourceId: employeeId,
        effectiveDate: req.body?.effectiveDate || null,
        reference: req.body?.reference ?? null,
        actorApplicationUserId: req.userId!,
        actorMembershipId: resolveActorMembershipId(req),
      });
      res.status(201).json(result.generated);
    } catch (err) {
      handleError(err, res);
    }
  },
);

// GET /organizations/:organizationId/generated-documents
router.get(
  "/organizations/:organizationId/generated-documents",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("document_template.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    res.json(
      await listGeneratedDocuments(resolveOrganizationId(req), {
        sourceType: typeof req.query.sourceType === "string" ? req.query.sourceType : undefined,
        sourceId: typeof req.query.sourceId === "string" ? parseInt(req.query.sourceId, 10) : undefined,
        templateId: typeof req.query.templateId === "string" ? parseInt(req.query.templateId, 10) : undefined,
      }),
    );
  },
);

// GET /organizations/:organizationId/generated-documents/:generatedId/download
router.get(
  "/organizations/:organizationId/generated-documents/:generatedId/download",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("document_template.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const generatedId = parseId(req.params.generatedId);
    if (isNaN(generatedId)) {
      res.status(400).json({ error: "Invalid document ID" });
      return;
    }
    const organizationId = resolveOrganizationId(req);
    const row = await getGeneratedDocument(organizationId, generatedId);
    if (!row) {
      res.status(404).json({ error: "Generated document not found" });
      return;
    }
    const buffer = await readOrgFile(organizationId, row.storageKey);
    res.set("Content-Type", row.mimeType || "application/pdf");
    res.set("Content-Disposition", `attachment; filename="${encodeURIComponent(row.fileName)}"`);
    res.set("Cache-Control", "private, no-store");
    res.send(buffer);
  },
);

export default router;
