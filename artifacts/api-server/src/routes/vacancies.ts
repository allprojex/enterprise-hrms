import { Router } from "express";
import { CreateVacancyBody, UpdateVacancyBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import { requireModuleEnabled } from "../middlewares/requireModuleEnabled";
import { RECRUITMENT_MODULE_KEY } from "../lib/recruitmentAuthorization";
import { CrossOrganizationReferenceError } from "../lib/orgScopedRefs";
import {
  listVacancies,
  createVacancy,
  getVisibleVacancyById,
  updateVacancy,
  publishVacancy,
  pauseVacancy,
  closeVacancy,
  archiveVacancy,
  resolveVacancyVisibilityContext,
  VacancyNotFoundError,
  VacancyNotEditableError,
  InvalidVacancyError,
  InvalidVacancyTransitionError,
  type VacancyVisibility,
} from "../lib/vacancies";

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

// GET /organizations/:organizationId/vacancies
router.get(
  "/organizations/:organizationId/vacancies",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("vacancy.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const organizationId = req.membership!.organizationId;
    const visibility = await resolveVacancyVisibilityContext({
      organizationId,
      applicationUserId: req.userId!,
      membershipId: req.membership!.id,
    });

    const page = Math.max(1, parseOptionalId(req.query.page) ?? 1);
    const pageSize = Math.min(100, Math.max(1, parseOptionalId(req.query.pageSize) ?? 20));

    const result = await listVacancies({
      organizationId,
      visibility,
      status: typeof req.query.status === "string" ? req.query.status : undefined,
      requisitionId: parseOptionalId(req.query.requisitionId),
      search: typeof req.query.search === "string" ? req.query.search : undefined,
      page,
      pageSize,
    });

    res.json({ ...result, page, pageSize });
  },
);

// POST /organizations/:organizationId/vacancies
router.post(
  "/organizations/:organizationId/vacancies",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("vacancy.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = CreateVacancyBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const vacancy = await createVacancy({
        organizationId: req.membership!.organizationId,
        fields: {
          ...parsed.data,
          visibility: parsed.data.visibility as VacancyVisibility | undefined,
        },
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.status(201).json(vacancy);
    } catch (err) {
      if (err instanceof InvalidVacancyError || err instanceof CrossOrganizationReferenceError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// GET /organizations/:organizationId/vacancies/:id
router.get(
  "/organizations/:organizationId/vacancies/:id",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("vacancy.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const vacancyId = parseId(req.params.id);
    if (isNaN(vacancyId)) {
      res.status(400).json({ error: "Invalid vacancy ID" });
      return;
    }
    const organizationId = req.membership!.organizationId;
    const visibility = await resolveVacancyVisibilityContext({
      organizationId,
      applicationUserId: req.userId!,
      membershipId: req.membership!.id,
    });
    const vacancy = await getVisibleVacancyById(organizationId, vacancyId, visibility);
    if (!vacancy) {
      res.status(404).json({ error: "Vacancy not found" });
      return;
    }
    res.json(vacancy);
  },
);

// PATCH /organizations/:organizationId/vacancies/:id
router.patch(
  "/organizations/:organizationId/vacancies/:id",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("vacancy.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const vacancyId = parseId(req.params.id);
    if (isNaN(vacancyId)) {
      res.status(400).json({ error: "Invalid vacancy ID" });
      return;
    }
    const parsed = UpdateVacancyBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const vacancy = await updateVacancy({
        organizationId: req.membership!.organizationId,
        vacancyId,
        fields: {
          ...parsed.data,
          visibility: parsed.data.visibility as VacancyVisibility | undefined,
        },
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(vacancy);
    } catch (err) {
      if (err instanceof VacancyNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof VacancyNotEditableError || err instanceof InvalidVacancyError || err instanceof CrossOrganizationReferenceError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// POST /organizations/:organizationId/vacancies/:id/publish
router.post(
  "/organizations/:organizationId/vacancies/:id/publish",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("vacancy.publish"),
  async (req: MembershipRequest, res): Promise<void> => {
    const vacancyId = parseId(req.params.id);
    if (isNaN(vacancyId)) {
      res.status(400).json({ error: "Invalid vacancy ID" });
      return;
    }
    try {
      const vacancy = await publishVacancy({
        organizationId: req.membership!.organizationId,
        vacancyId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(vacancy);
    } catch (err) {
      if (err instanceof VacancyNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof InvalidVacancyTransitionError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// POST /organizations/:organizationId/vacancies/:id/pause
router.post(
  "/organizations/:organizationId/vacancies/:id/pause",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("vacancy.publish"),
  async (req: MembershipRequest, res): Promise<void> => {
    const vacancyId = parseId(req.params.id);
    if (isNaN(vacancyId)) {
      res.status(400).json({ error: "Invalid vacancy ID" });
      return;
    }
    try {
      const vacancy = await pauseVacancy({
        organizationId: req.membership!.organizationId,
        vacancyId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(vacancy);
    } catch (err) {
      if (err instanceof VacancyNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof InvalidVacancyTransitionError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// POST /organizations/:organizationId/vacancies/:id/close
router.post(
  "/organizations/:organizationId/vacancies/:id/close",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("vacancy.close"),
  async (req: MembershipRequest, res): Promise<void> => {
    const vacancyId = parseId(req.params.id);
    if (isNaN(vacancyId)) {
      res.status(400).json({ error: "Invalid vacancy ID" });
      return;
    }
    try {
      const vacancy = await closeVacancy({
        organizationId: req.membership!.organizationId,
        vacancyId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(vacancy);
    } catch (err) {
      if (err instanceof VacancyNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof InvalidVacancyTransitionError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// POST /organizations/:organizationId/vacancies/:id/archive
router.post(
  "/organizations/:organizationId/vacancies/:id/archive",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("vacancy.close"),
  async (req: MembershipRequest, res): Promise<void> => {
    const vacancyId = parseId(req.params.id);
    if (isNaN(vacancyId)) {
      res.status(400).json({ error: "Invalid vacancy ID" });
      return;
    }
    try {
      const vacancy = await archiveVacancy({
        organizationId: req.membership!.organizationId,
        vacancyId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(vacancy);
    } catch (err) {
      if (err instanceof VacancyNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof InvalidVacancyTransitionError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

export default router;
