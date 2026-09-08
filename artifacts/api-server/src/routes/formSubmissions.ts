/**
 * WS-26 — form submission routes.
 *
 * Every route runs requireAuth → requireMembership(:organizationId); the
 * service decides visibility per submission (HR with `form.read`, the subject
 * employee, the creator, the current stage's actor) and answers "not found"
 * for everyone else so an id's existence is never confirmed across tenants.
 * A submission is created for oneself through the employee link, or for
 * another employee only with `form.assess`. Finalize and archive carry their
 * own keys. Downloads stream through this authenticated route only.
 */
import { Router } from "express";
import {
  CreateFormSubmissionBody,
  SaveFormSubmissionDraftBody,
  SubmitFormSubmissionBody,
  ActOnFormSubmissionStageBody,
} from "@workspace/api-zod";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { requireMembership, resolveOrganizationId, resolveActorMembershipId, type MembershipRequest } from "../middlewares/requireMembership";
import { readOrgFile } from "../lib/fileStorage";
import { getGeneratedDocument } from "../lib/documentGeneration";
import { getTemplate, getVersion, parseDefinition } from "../lib/formEngine/templates";
import { redactedSensitiveKeys } from "../lib/formEngine/sensitivity";
import { getModuleAccess } from "../lib/organizationModules";
import {
  buildViewerContext,
  listVisibleSubmissions,
  getSubmissionDetail,
  getSubmission,
  canViewSubmission,
  createSubmission,
  saveDraft,
  submit,
  stageAction,
  finalize,
  archive,
  recordDownload,
  FormSubmissionNotFoundError,
  FormSubmissionStateError,
  FormStageAuthorityError,
  FormSubmissionFinalizedError,
  FormSubjectNotFoundError,
  type FormActor,
} from "../lib/formEngine/submissions";
import { FormAnswersError } from "../lib/formEngine/answers";
import { renderSubmissionDocument, documentKindForStatus, type DocumentKind } from "../lib/formEngine/render";

const router = Router();
type Req = MembershipRequest & AuthenticatedRequest;

function parseId(raw: unknown): number {
  const n = Number.parseInt(String(raw), 10);
  return Number.isInteger(n) && n > 0 ? n : NaN;
}

function actorOf(req: Req): FormActor {
  return {
    userId: req.userId!,
    membershipId: resolveActorMembershipId(req) ?? req.membership!.id,
    requestId: (req as { id?: string | number }).id != null ? String((req as { id?: string | number }).id) : null,
  };
}

function handleError(err: unknown, res: import("express").Response): boolean {
  if (err instanceof FormSubmissionNotFoundError || err instanceof FormSubjectNotFoundError) {
    res.status(404).json({ error: "Form submission not found" });
    return true;
  }
  if (err instanceof FormAnswersError) {
    res.status(400).json({ error: err.message, issues: err.issues });
    return true;
  }
  if (err instanceof FormStageAuthorityError) {
    res.status(403).json({ error: err.message });
    return true;
  }
  if (err instanceof FormSubmissionStateError || err instanceof FormSubmissionFinalizedError) {
    res.status(409).json({ error: err.message });
    return true;
  }
  return false;
}

// GET /organizations/:organizationId/form-submissions
router.get(
  "/organizations/:organizationId/form-submissions",
  requireAuth as any,
  requireMembership("organizationId"),
  async (req: Req, res): Promise<void> => {
    const organizationId = resolveOrganizationId(req);
    const viewer = await buildViewerContext(organizationId, actorOf(req));
    const filter: Parameters<typeof listVisibleSubmissions>[2] = {};
    if (req.query.templateId) filter.templateId = parseId(req.query.templateId);
    if (req.query.subjectEmployeeId) filter.subjectEmployeeId = parseId(req.query.subjectEmployeeId);
    if (typeof req.query.status === "string") filter.status = req.query.status as NonNullable<typeof filter.status>;
    if ([filter.templateId, filter.subjectEmployeeId].some((v) => v !== undefined && Number.isNaN(v))) {
      res.status(400).json({ error: "Invalid filter" });
      return;
    }
    res.json({ submissions: await listVisibleSubmissions(organizationId, viewer, filter) });
  },
);

// POST /organizations/:organizationId/form-submissions
router.post(
  "/organizations/:organizationId/form-submissions",
  requireAuth as any,
  requireMembership("organizationId"),
  async (req: Req, res): Promise<void> => {
    const parsed = CreateFormSubmissionBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const organizationId = resolveOrganizationId(req);
    const actor = actorOf(req);
    const viewer = await buildViewerContext(organizationId, actor);
    const subjectEmployeeId = parsed.data.subjectEmployeeId ?? viewer.employeeId;
    if (subjectEmployeeId == null) {
      res.status(400).json({ error: "You are not linked to an employee record; choose the employee this form is for" });
      return;
    }
    if (subjectEmployeeId !== viewer.employeeId && !viewer.permissions.has("form.assess")) {
      res.status(403).json({ error: "form.assess is required to raise a form for another employee" });
      return;
    }
    const template = await getTemplate(organizationId, parsed.data.templateId);
    if (!template || template.status !== "active") {
      res.status(404).json({ error: "Form template not found" });
      return;
    }
    if (template.moduleKey && !(await getModuleAccess(organizationId, template.moduleKey)).enabled) {
      res.status(403).json({ error: `Module "${template.moduleKey}" is not enabled for this organization` });
      return;
    }
    try {
      const created = await createSubmission({ organizationId, templateId: template.id, subjectEmployeeId, actor });
      const detail = await getSubmissionDetail(organizationId, created.id, viewer);
      res.status(201).json(detail);
    } catch (err) {
      if (!handleError(err, res)) throw err;
    }
  },
);

// GET /organizations/:organizationId/form-submissions/:submissionId
router.get(
  "/organizations/:organizationId/form-submissions/:submissionId",
  requireAuth as any,
  requireMembership("organizationId"),
  async (req: Req, res): Promise<void> => {
    const submissionId = parseId(req.params.submissionId);
    if (Number.isNaN(submissionId)) {
      res.status(400).json({ error: "Invalid submission ID" });
      return;
    }
    const organizationId = resolveOrganizationId(req);
    const viewer = await buildViewerContext(organizationId, actorOf(req));
    const detail = await getSubmissionDetail(organizationId, submissionId, viewer);
    if (!detail) {
      res.status(404).json({ error: "Form submission not found" });
      return;
    }
    res.json(detail);
  },
);

async function withDetail(req: Req, res: import("express").Response, run: (ctx: { organizationId: number; submissionId: number; viewer: Awaited<ReturnType<typeof buildViewerContext>>; actor: FormActor }) => Promise<void>): Promise<void> {
  const submissionId = parseId(req.params.submissionId);
  if (Number.isNaN(submissionId)) {
    res.status(400).json({ error: "Invalid submission ID" });
    return;
  }
  const organizationId = resolveOrganizationId(req);
  const actor = actorOf(req);
  const viewer = await buildViewerContext(organizationId, actor);
  const submission = await getSubmission(organizationId, submissionId);
  if (!submission || !(await canViewSubmission(organizationId, submission, viewer))) {
    res.status(404).json({ error: "Form submission not found" });
    return;
  }
  try {
    await run({ organizationId, submissionId, viewer, actor });
  } catch (err) {
    if (!handleError(err, res)) throw err;
  }
}

// PUT /organizations/:organizationId/form-submissions/:submissionId/draft
router.put(
  "/organizations/:organizationId/form-submissions/:submissionId/draft",
  requireAuth as any,
  requireMembership("organizationId"),
  async (req: Req, res): Promise<void> => {
    const parsed = SaveFormSubmissionDraftBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    await withDetail(req, res, async ({ organizationId, submissionId, viewer, actor }) => {
      await saveDraft({ organizationId, submissionId, answers: parsed.data.answers, viewer, actor });
      res.json(await getSubmissionDetail(organizationId, submissionId, viewer));
    });
  },
);

// POST /organizations/:organizationId/form-submissions/:submissionId/submit
router.post(
  "/organizations/:organizationId/form-submissions/:submissionId/submit",
  requireAuth as any,
  requireMembership("organizationId"),
  async (req: Req, res): Promise<void> => {
    const parsed = SubmitFormSubmissionBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    await withDetail(req, res, async ({ organizationId, submissionId, viewer, actor }) => {
      await submit({ organizationId, submissionId, answers: parsed.data.answers, viewer, actor });
      res.json(await getSubmissionDetail(organizationId, submissionId, viewer));
    });
  },
);

// POST /organizations/:organizationId/form-submissions/:submissionId/stage-action
router.post(
  "/organizations/:organizationId/form-submissions/:submissionId/stage-action",
  requireAuth as any,
  requireMembership("organizationId"),
  async (req: Req, res): Promise<void> => {
    const parsed = ActOnFormSubmissionStageBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    await withDetail(req, res, async ({ organizationId, submissionId, viewer, actor }) => {
      await stageAction({ organizationId, submissionId, action: parsed.data.action, answers: parsed.data.answers, notes: parsed.data.notes ?? null, viewer, actor });
      res.json(await getSubmissionDetail(organizationId, submissionId, viewer));
    });
  },
);

// POST /organizations/:organizationId/form-submissions/:submissionId/finalize
router.post(
  "/organizations/:organizationId/form-submissions/:submissionId/finalize",
  requireAuth as any,
  requireMembership("organizationId"),
  async (req: Req, res): Promise<void> => {
    await withDetail(req, res, async ({ organizationId, submissionId, viewer, actor }) => {
      await finalize({ organizationId, submissionId, viewer, actor });
      res.json(await getSubmissionDetail(organizationId, submissionId, viewer));
    });
  },
);

// POST /organizations/:organizationId/form-submissions/:submissionId/archive
router.post(
  "/organizations/:organizationId/form-submissions/:submissionId/archive",
  requireAuth as any,
  requireMembership("organizationId"),
  async (req: Req, res): Promise<void> => {
    await withDetail(req, res, async ({ organizationId, submissionId, viewer, actor }) => {
      await archive({ organizationId, submissionId, viewer, actor });
      res.json(await getSubmissionDetail(organizationId, submissionId, viewer));
    });
  },
);

const KINDS = new Set<DocumentKind>(["blank", "draft", "submitted", "returned", "rejected", "approved", "final"]);

// GET /organizations/:organizationId/form-submissions/:submissionId/document.pdf?kind=&revisionId=
router.get(
  "/organizations/:organizationId/form-submissions/:submissionId/document.pdf",
  requireAuth as any,
  requireMembership("organizationId"),
  async (req: Req, res): Promise<void> => {
    await withDetail(req, res, async ({ organizationId, submissionId, viewer, actor }) => {
      const submission = (await getSubmission(organizationId, submissionId))!;
      const requested = typeof req.query.kind === "string" ? (req.query.kind as DocumentKind) : documentKindForStatus(submission.status);
      if (!KINDS.has(requested)) {
        res.status(400).json({ error: "Invalid document kind" });
        return;
      }
      const revisionId = req.query.revisionId ? parseId(req.query.revisionId) : null;
      if (revisionId !== null && Number.isNaN(revisionId)) {
        res.status(400).json({ error: "Invalid revision ID" });
        return;
      }
      // WS-26C: sensitive field values this viewer may not see (subject sees own;
      // others need the field's readPermission). Applied to every rendered kind,
      // and to the final download (see below) so no path leaks a protected value.
      const version = await getVersion(organizationId, submission.templateVersionId);
      const redactedValueKeys = version
        ? redactedSensitiveKeys(parseDefinition(version), viewer, submission.subjectEmployeeId)
        : new Set<string>();

      let pdf: Buffer;
      let fileName: string;
      if (requested === "final") {
        if (!submission.finalDocumentId || (!viewer.permissions.has("form.final.read") && !(viewer.employeeId != null && viewer.employeeId === submission.subjectEmployeeId))) {
          res.status(submission.finalDocumentId ? 403 : 409).json({ error: submission.finalDocumentId ? "form.final.read is required" : "This form has not been finalized" });
          return;
        }
        if (redactedValueKeys.size > 0) {
          // The viewer may read the final but not its sensitive fields: serve a
          // redacted on-demand re-render (with the certificate) rather than the
          // immutable stored bytes, so the protected values never leave.
          pdf = await renderSubmissionDocument({ organizationId, submissionId, kind: "final", redactedValueKeys });
          fileName = `form-${submissionId}-final-redacted.pdf`;
        } else {
          const generated = await getGeneratedDocument(organizationId, submission.finalDocumentId);
          if (!generated) {
            res.status(404).json({ error: "Final document not found" });
            return;
          }
          pdf = await readOrgFile(organizationId, generated.storageKey);
          fileName = generated.fileName;
        }
      } else {
        const kind: DocumentKind = requested === "blank" ? "blank" : requested;
        pdf = await renderSubmissionDocument({ organizationId, submissionId, kind, revisionId, redactedValueKeys });
        fileName = `form-${submissionId}-${kind}${revisionId ? `-r${revisionId}` : ""}.pdf`;
      }
      await recordDownload({ organizationId, submissionId, kind: requested, revisionId, actor });
      res.set("Content-Type", "application/pdf");
      res.set("Content-Disposition", `attachment; filename="${encodeURIComponent(fileName)}"`);
      res.set("Cache-Control", "private, no-store");
      res.send(pdf);
    });
  },
);

export default router;
