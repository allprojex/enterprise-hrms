/**
 * WS-26 — form template routes.
 *
 * Authority chain on every route: requireAuth → requireMembership(:organizationId)
 * → requirePermission where the action is administrative. Listing and reading
 * a PUBLISHED template is open to any active member (an employee has to see
 * the form to fill it); drafts, archived versions and every write need
 * `form_template.manage`, and publishing needs `form_template.publish`.
 * Everything is scoped by the organization id requireMembership proved —
 * the path id is a lookup key, never an authority.
 */
import { Router } from "express";
import {
  CreateFormTemplateBody,
  CreateFormTemplateVersionBody,
  UpdateFormTemplateVersionBody,
} from "@workspace/api-zod";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { requireMembership, resolveOrganizationId, resolveActorMembershipId, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import { getEffectivePermissions } from "../lib/permissions";
import { recordAuditEvent } from "../lib/auditLog";
import {
  listTemplates,
  getTemplate,
  getVersion,
  listVersions,
  listStages,
  createTemplate,
  createDraftVersion,
  updateDraftVersion,
  publishVersion,
  archiveTemplate,
  FormTemplateNotFoundError,
  FormVersionNotFoundError,
  FormTemplateStateError,
  FormStageConfigError,
} from "../lib/formEngine/templates";
import { allowsOnBehalfSubmission } from "../lib/formEngine/assistedSubmission";
import { FormDefinitionError } from "../lib/formEngine/definition";
import { renderBlankDocument } from "../lib/formEngine/render";

const router = Router();
type Req = MembershipRequest & AuthenticatedRequest;

function parseId(raw: unknown): number {
  const n = Number.parseInt(String(raw), 10);
  return Number.isInteger(n) && n > 0 ? n : NaN;
}

function actorOf(req: Req) {
  return { actorApplicationUserId: req.userId!, actorMembershipId: resolveActorMembershipId(req) ?? req.membership!.id };
}

function handleError(err: unknown, res: import("express").Response): boolean {
  if (err instanceof FormTemplateNotFoundError || err instanceof FormVersionNotFoundError) {
    res.status(404).json({ error: "Form template not found" });
    return true;
  }
  if (err instanceof FormDefinitionError || err instanceof FormStageConfigError) {
    res.status(400).json({ error: err.message });
    return true;
  }
  if (err instanceof FormTemplateStateError) {
    res.status(409).json({ error: err.message });
    return true;
  }
  return false;
}

async function canManage(req: Req): Promise<boolean> {
  const membershipId = resolveActorMembershipId(req);
  if (membershipId == null) return false;
  const permissions = await getEffectivePermissions(membershipId);
  return permissions.has("form_template.manage") || permissions.has("form.read");
}

function versionView(v: Awaited<ReturnType<typeof getVersion>> & object, stages: Awaited<ReturnType<typeof listStages>>) {
  return {
    id: v.id,
    templateId: v.templateId,
    versionNumber: v.versionNumber,
    status: v.status,
    effectiveFrom: v.effectiveFrom,
    effectiveTo: v.effectiveTo,
    definition: v.definition,
    definitionSha256: v.definitionSha256,
    signaturePolicy: v.signaturePolicy,
    renderConfig: v.renderConfig,
    changeNote: v.changeNote,
    firstUsedAt: v.firstUsedAt,
    publishedAt: v.publishedAt,
    archivedAt: v.archivedAt,
    createdAt: v.createdAt,
    stages: stages.map((s) => ({
      id: s.id,
      stageOrder: s.stageOrder,
      name: s.name,
      participant: s.participant,
      resolver: s.resolver,
      resolverConfig: s.resolverConfig,
      editableSectionKeys: s.editableSectionKeys,
      allowedActions: s.allowedActions,
      signatureSlotKey: s.signatureSlotKey,
    })),
  };
}

// GET /organizations/:organizationId/form-templates
router.get(
  "/organizations/:organizationId/form-templates",
  requireAuth as any,
  requireMembership("organizationId"),
  async (req: Req, res): Promise<void> => {
    const organizationId = resolveOrganizationId(req);
    const manager = await canManage(req);
    const templates = await listTemplates(organizationId, manager ? {} : { status: "active" });
    const visible = manager ? templates : templates.filter((t) => t.currentPublishedVersionId != null);
    res.json({
      templates: visible.map((t) => ({
        id: t.id,
        templateKey: t.templateKey,
        formType: t.formType,
        moduleKey: t.moduleKey,
        title: t.title,
        description: t.description,
        status: t.status,
        currentPublishedVersionId: t.currentPublishedVersionId,
        // Lets an HR surface offer "complete on behalf" only where the PUBLISHED
        // version actually permits it. A boolean, not the raw policy object: the
        // client never needs to interpret policy semantics, and cannot drift from
        // the server if more keys are added later.
        allowsOnBehalfSubmission: allowsOnBehalfSubmission(
          t.versions.find((v) => v.id === t.currentPublishedVersionId) ?? { submissionPolicy: null },
        ),
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        versions: manager ? t.versions : t.versions.filter((v) => v.status === "published"),
      })),
    });
  },
);

// POST /organizations/:organizationId/form-templates
router.post(
  "/organizations/:organizationId/form-templates",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("form_template.manage"),
  async (req: Req, res): Promise<void> => {
    const parsed = CreateFormTemplateBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const { template, version } = await createTemplate({
        organizationId: resolveOrganizationId(req),
        ...parsed.data,
        ...actorOf(req),
      });
      const stages = await listStages(template.organizationId, version.id);
      res.status(201).json({ template, version: versionView(version, stages) });
    } catch (err) {
      if (!handleError(err, res)) throw err;
    }
  },
);

// GET /organizations/:organizationId/form-templates/:templateId
router.get(
  "/organizations/:organizationId/form-templates/:templateId",
  requireAuth as any,
  requireMembership("organizationId"),
  async (req: Req, res): Promise<void> => {
    const templateId = parseId(req.params.templateId);
    if (Number.isNaN(templateId)) {
      res.status(400).json({ error: "Invalid template ID" });
      return;
    }
    const organizationId = resolveOrganizationId(req);
    const template = await getTemplate(organizationId, templateId);
    const manager = await canManage(req);
    if (!template || (!manager && (template.status !== "active" || template.currentPublishedVersionId == null))) {
      res.status(404).json({ error: "Form template not found" });
      return;
    }
    const versions = await listVersions(organizationId, templateId);
    const shown = manager ? versions : versions.filter((v) => v.status === "published");
    const detailed = [];
    for (const v of shown) detailed.push(versionView(v, await listStages(organizationId, v.id)));
    res.json({ template, versions: detailed });
  },
);

// POST /organizations/:organizationId/form-templates/:templateId/versions
router.post(
  "/organizations/:organizationId/form-templates/:templateId/versions",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("form_template.manage"),
  async (req: Req, res): Promise<void> => {
    const templateId = parseId(req.params.templateId);
    if (Number.isNaN(templateId)) {
      res.status(400).json({ error: "Invalid template ID" });
      return;
    }
    const parsed = CreateFormTemplateVersionBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const organizationId = resolveOrganizationId(req);
      const version = await createDraftVersion({ organizationId, templateId, ...parsed.data, ...actorOf(req) });
      res.status(201).json(versionView(version, await listStages(organizationId, version.id)));
    } catch (err) {
      if (!handleError(err, res)) throw err;
    }
  },
);

// POST /organizations/:organizationId/form-templates/:templateId/archive
router.post(
  "/organizations/:organizationId/form-templates/:templateId/archive",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("form_template.manage"),
  async (req: Req, res): Promise<void> => {
    const templateId = parseId(req.params.templateId);
    if (Number.isNaN(templateId)) {
      res.status(400).json({ error: "Invalid template ID" });
      return;
    }
    try {
      const template = await archiveTemplate({ organizationId: resolveOrganizationId(req), templateId, ...actorOf(req) });
      res.json(template);
    } catch (err) {
      if (!handleError(err, res)) throw err;
    }
  },
);

// GET /organizations/:organizationId/form-template-versions/:versionId
router.get(
  "/organizations/:organizationId/form-template-versions/:versionId",
  requireAuth as any,
  requireMembership("organizationId"),
  async (req: Req, res): Promise<void> => {
    const versionId = parseId(req.params.versionId);
    if (Number.isNaN(versionId)) {
      res.status(400).json({ error: "Invalid version ID" });
      return;
    }
    const organizationId = resolveOrganizationId(req);
    const version = await getVersion(organizationId, versionId);
    const manager = await canManage(req);
    if (!version || (!manager && version.status !== "published")) {
      res.status(404).json({ error: "Form template version not found" });
      return;
    }
    res.json(versionView(version, await listStages(organizationId, versionId)));
  },
);

// PATCH /organizations/:organizationId/form-template-versions/:versionId
router.patch(
  "/organizations/:organizationId/form-template-versions/:versionId",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("form_template.manage"),
  async (req: Req, res): Promise<void> => {
    const versionId = parseId(req.params.versionId);
    if (Number.isNaN(versionId)) {
      res.status(400).json({ error: "Invalid version ID" });
      return;
    }
    const parsed = UpdateFormTemplateVersionBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const organizationId = resolveOrganizationId(req);
      const version = await updateDraftVersion({ organizationId, versionId, ...parsed.data, ...actorOf(req) });
      res.json(versionView(version, await listStages(organizationId, versionId)));
    } catch (err) {
      if (!handleError(err, res)) throw err;
    }
  },
);

// POST /organizations/:organizationId/form-template-versions/:versionId/publish
router.post(
  "/organizations/:organizationId/form-template-versions/:versionId/publish",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("form_template.publish"),
  async (req: Req, res): Promise<void> => {
    const versionId = parseId(req.params.versionId);
    if (Number.isNaN(versionId)) {
      res.status(400).json({ error: "Invalid version ID" });
      return;
    }
    try {
      const organizationId = resolveOrganizationId(req);
      const version = await publishVersion({ organizationId, versionId, ...actorOf(req) });
      res.json(versionView(version, await listStages(organizationId, versionId)));
    } catch (err) {
      if (!handleError(err, res)) throw err;
    }
  },
);

// GET /organizations/:organizationId/form-template-versions/:versionId/blank.pdf
router.get(
  "/organizations/:organizationId/form-template-versions/:versionId/blank.pdf",
  requireAuth as any,
  requireMembership("organizationId"),
  async (req: Req, res): Promise<void> => {
    const versionId = parseId(req.params.versionId);
    if (Number.isNaN(versionId)) {
      res.status(400).json({ error: "Invalid version ID" });
      return;
    }
    const organizationId = resolveOrganizationId(req);
    const version = await getVersion(organizationId, versionId);
    const manager = await canManage(req);
    if (!version || (!manager && version.status !== "published")) {
      res.status(404).json({ error: "Form template version not found" });
      return;
    }
    const template = await getTemplate(organizationId, version.templateId);
    const pdf = await renderBlankDocument({ organizationId, versionId });
    await recordAuditEvent({
      ...actorOf(req),
      organizationId,
      eventType: "form_template.blank_downloaded",
      targetType: "form_template_version",
      targetId: String(versionId),
      metadata: { templateId: version.templateId, versionNumber: version.versionNumber },
    });
    const fileName = `${(template?.title ?? "form").replace(/[^A-Za-z0-9-_ ]/g, "").trim() || "form"} - blank.pdf`;
    res.set("Content-Type", "application/pdf");
    res.set("Content-Disposition", `attachment; filename="${encodeURIComponent(fileName)}"`);
    res.set("Cache-Control", "private, no-store");
    res.send(pdf);
  },
);

export default router;
