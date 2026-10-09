import { Router } from "express";
import { CreateCandidateNoteBody, AddCandidateTagBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import { requireModuleEnabled } from "../middlewares/requireModuleEnabled";
import { RECRUITMENT_MODULE_KEY } from "../lib/recruitmentAuthorization";
import { isUniqueViolation } from "../lib/dbErrors";
import { listCandidates, getVisibleCandidateById, resolveCandidateVisibilityContext } from "../lib/candidates";
import { listCandidateNotes, createCandidateNote, canAccessCandidateNotes, InvalidCandidateNoteError } from "../lib/candidateNotes";
import { listCandidateTags, addCandidateTag, removeCandidateTag, InvalidCandidateTagError, DuplicateCandidateTagError, CandidateTagNotFoundError } from "../lib/candidateTags";

const router = Router();

function parseId(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(value ?? "", 10);
}

function parseOptionalId(raw: unknown): number | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string" || value === "") return undefined;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? undefined : parsed;
}

function parseOptionalString(raw: unknown): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" && value !== "" ? value : undefined;
}

// GET /organizations/:organizationId/candidates
router.get(
  "/organizations/:organizationId/candidates",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("candidate.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const organizationId = req.membership!.organizationId;
    const visibility = await resolveCandidateVisibilityContext({
      organizationId,
      applicationUserId: req.userId!,
      membershipId: req.membership!.id,
    });

    const page = Math.max(1, parseOptionalId(req.query.page) ?? 1);
    const pageSize = Math.min(100, Math.max(1, parseOptionalId(req.query.pageSize) ?? 20));

    const result = await listCandidates({
      organizationId,
      visibility,
      search: parseOptionalString(req.query.search),
      page,
      pageSize,
    });

    res.json({ ...result, page, pageSize });
  },
);

// GET /organizations/:organizationId/candidates/:id
router.get(
  "/organizations/:organizationId/candidates/:id",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("candidate.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const candidateId = parseId(req.params.id);
    if (isNaN(candidateId)) {
      res.status(400).json({ error: "Invalid candidate ID" });
      return;
    }
    const organizationId = req.membership!.organizationId;
    const visibility = await resolveCandidateVisibilityContext({
      organizationId,
      applicationUserId: req.userId!,
      membershipId: req.membership!.id,
    });
    const candidate = await getVisibleCandidateById(organizationId, candidateId, visibility);
    if (!candidate) {
      res.status(404).json({ error: "Candidate not found" });
      return;
    }
    res.json(candidate);
  },
);

// GET /organizations/:organizationId/candidates/:id/notes
router.get(
  "/organizations/:organizationId/candidates/:id/notes",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("candidate.notes.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const candidateId = parseId(req.params.id);
    if (isNaN(candidateId)) {
      res.status(400).json({ error: "Invalid candidate ID" });
      return;
    }
    const organizationId = req.membership!.organizationId;
    const visibility = await resolveCandidateVisibilityContext({
      organizationId,
      applicationUserId: req.userId!,
      membershipId: req.membership!.id,
    });
    const candidate = await getVisibleCandidateById(organizationId, candidateId, visibility);
    if (!candidate) {
      res.status(404).json({ error: "Candidate not found" });
      return;
    }
    // Seeing the candidate (e.g. as hiring manager) is not enough — notes are recruitment-only.
    if (!canAccessCandidateNotes(visibility)) {
      res.status(403).json({ error: "Candidate notes are restricted to recruitment staff" });
      return;
    }
    const notes = await listCandidateNotes(organizationId, candidateId);
    res.json(notes);
  },
);

// POST /organizations/:organizationId/candidates/:id/notes
router.post(
  "/organizations/:organizationId/candidates/:id/notes",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("candidate.notes.write"),
  async (req: MembershipRequest, res): Promise<void> => {
    const candidateId = parseId(req.params.id);
    if (isNaN(candidateId)) {
      res.status(400).json({ error: "Invalid candidate ID" });
      return;
    }
    const organizationId = req.membership!.organizationId;
    const visibility = await resolveCandidateVisibilityContext({
      organizationId,
      applicationUserId: req.userId!,
      membershipId: req.membership!.id,
    });
    const candidate = await getVisibleCandidateById(organizationId, candidateId, visibility);
    if (!candidate) {
      res.status(404).json({ error: "Candidate not found" });
      return;
    }
    if (!canAccessCandidateNotes(visibility)) {
      res.status(403).json({ error: "Candidate notes are restricted to recruitment staff" });
      return;
    }
    const parsed = CreateCandidateNoteBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const note = await createCandidateNote({
        organizationId,
        candidateId,
        applicationId: parsed.data.applicationId,
        note: parsed.data.note,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.status(201).json(note);
    } catch (err) {
      if (err instanceof InvalidCandidateNoteError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// GET /organizations/:organizationId/candidates/:id/tags
router.get(
  "/organizations/:organizationId/candidates/:id/tags",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("candidate.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const candidateId = parseId(req.params.id);
    if (isNaN(candidateId)) {
      res.status(400).json({ error: "Invalid candidate ID" });
      return;
    }
    const organizationId = req.membership!.organizationId;
    const visibility = await resolveCandidateVisibilityContext({
      organizationId,
      applicationUserId: req.userId!,
      membershipId: req.membership!.id,
    });
    const candidate = await getVisibleCandidateById(organizationId, candidateId, visibility);
    if (!candidate) {
      res.status(404).json({ error: "Candidate not found" });
      return;
    }
    const tags = await listCandidateTags(organizationId, candidateId);
    res.json(tags);
  },
);

// POST /organizations/:organizationId/candidates/:id/tags
router.post(
  "/organizations/:organizationId/candidates/:id/tags",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("candidate.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const candidateId = parseId(req.params.id);
    if (isNaN(candidateId)) {
      res.status(400).json({ error: "Invalid candidate ID" });
      return;
    }
    const organizationId = req.membership!.organizationId;
    const visibility = await resolveCandidateVisibilityContext({
      organizationId,
      applicationUserId: req.userId!,
      membershipId: req.membership!.id,
    });
    const candidate = await getVisibleCandidateById(organizationId, candidateId, visibility);
    if (!candidate) {
      res.status(404).json({ error: "Candidate not found" });
      return;
    }
    const parsed = AddCandidateTagBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const tag = await addCandidateTag({
        organizationId,
        candidateId,
        tag: parsed.data.tag,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.status(201).json(tag);
    } catch (err) {
      if (err instanceof InvalidCandidateTagError) {
        res.status(400).json({ error: err.message });
        return;
      }
      if (err instanceof DuplicateCandidateTagError || isUniqueViolation(err)) {
        res.status(409).json({ error: "This candidate already has that tag" });
        return;
      }
      throw err;
    }
  },
);

// DELETE /organizations/:organizationId/candidates/:id/tags/:tagId
router.delete(
  "/organizations/:organizationId/candidates/:id/tags/:tagId",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("candidate.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const candidateId = parseId(req.params.id);
    const tagId = parseId(req.params.tagId);
    if (isNaN(candidateId) || isNaN(tagId)) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    const organizationId = req.membership!.organizationId;
    const visibility = await resolveCandidateVisibilityContext({
      organizationId,
      applicationUserId: req.userId!,
      membershipId: req.membership!.id,
    });
    const candidate = await getVisibleCandidateById(organizationId, candidateId, visibility);
    if (!candidate) {
      res.status(404).json({ error: "Candidate not found" });
      return;
    }
    try {
      await removeCandidateTag({
        organizationId,
        candidateId,
        tagId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.status(204).send();
    } catch (err) {
      if (err instanceof CandidateTagNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

export default router;
