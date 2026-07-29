import { Router } from "express";
import { CreatePublicHolidayBody, UpdatePublicHolidayBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import { requireModuleEnabled } from "../middlewares/requireModuleEnabled";
import { toIsoDate } from "../lib/leaveRequests";
import {
  listPublicHolidays,
  getPublicHolidayById,
  createPublicHoliday,
  updatePublicHoliday,
  deactivatePublicHoliday,
  reactivatePublicHoliday,
  deletePublicHoliday,
  PublicHolidayNotFoundError,
  InvalidPublicHolidayError,
  DuplicatePublicHolidayError,
} from "../lib/publicHolidays";

const router = Router();

function parseId(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(value ?? "", 10);
}

// GET /organizations/:organizationId/public-holidays?year=
router.get(
  "/organizations/:organizationId/public-holidays",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("leave"),
  requirePermission("public_holiday.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const rawYear = req.query.year;
    let year: number | undefined;
    if (typeof rawYear === "string" && rawYear.length > 0) {
      const parsed = parseInt(rawYear, 10);
      if (isNaN(parsed)) {
        res.status(400).json({ error: "Invalid year" });
        return;
      }
      year = parsed;
    }

    const holidays = await listPublicHolidays(req.membership!.organizationId, { year });
    res.json(holidays);
  },
);

// GET /organizations/:organizationId/public-holidays/:id
router.get(
  "/organizations/:organizationId/public-holidays/:id",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("leave"),
  requirePermission("public_holiday.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const holidayId = parseId(req.params.id);
    if (isNaN(holidayId)) {
      res.status(400).json({ error: "Invalid holiday ID" });
      return;
    }
    const holiday = await getPublicHolidayById(req.membership!.organizationId, holidayId);
    if (!holiday) {
      res.status(404).json({ error: "Public holiday not found" });
      return;
    }
    res.json(holiday);
  },
);

// POST /organizations/:organizationId/public-holidays
router.post(
  "/organizations/:organizationId/public-holidays",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("leave"),
  requirePermission("public_holiday.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = CreatePublicHolidayBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    try {
      const holiday = await createPublicHoliday({
        organizationId: req.membership!.organizationId,
        name: parsed.data.name,
        date: toIsoDate(parsed.data.date),
        recurring: parsed.data.recurring,
        observedDate: parsed.data.observedDate ? toIsoDate(parsed.data.observedDate) : null,
        effectiveYear: parsed.data.effectiveYear,
        description: parsed.data.description,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.status(201).json(holiday);
    } catch (err) {
      if (err instanceof InvalidPublicHolidayError) {
        res.status(400).json({ error: err.message });
        return;
      }
      if (err instanceof DuplicatePublicHolidayError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// PATCH /organizations/:organizationId/public-holidays/:id
router.patch(
  "/organizations/:organizationId/public-holidays/:id",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("leave"),
  requirePermission("public_holiday.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const holidayId = parseId(req.params.id);
    if (isNaN(holidayId)) {
      res.status(400).json({ error: "Invalid holiday ID" });
      return;
    }

    const parsed = UpdatePublicHolidayBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    try {
      const holiday = await updatePublicHoliday({
        organizationId: req.membership!.organizationId,
        holidayId,
        name: parsed.data.name,
        date: parsed.data.date ? toIsoDate(parsed.data.date) : undefined,
        recurring: parsed.data.recurring,
        observedDate: parsed.data.observedDate === undefined ? undefined : parsed.data.observedDate === null ? null : toIsoDate(parsed.data.observedDate),
        effectiveYear: parsed.data.effectiveYear,
        description: parsed.data.description,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(holiday);
    } catch (err) {
      if (err instanceof PublicHolidayNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof InvalidPublicHolidayError) {
        res.status(400).json({ error: err.message });
        return;
      }
      if (err instanceof DuplicatePublicHolidayError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// POST /organizations/:organizationId/public-holidays/:id/deactivate
router.post(
  "/organizations/:organizationId/public-holidays/:id/deactivate",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("leave"),
  requirePermission("public_holiday.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const holidayId = parseId(req.params.id);
    if (isNaN(holidayId)) {
      res.status(400).json({ error: "Invalid holiday ID" });
      return;
    }
    try {
      const holiday = await deactivatePublicHoliday({
        organizationId: req.membership!.organizationId,
        holidayId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(holiday);
    } catch (err) {
      if (err instanceof PublicHolidayNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// POST /organizations/:organizationId/public-holidays/:id/reactivate
router.post(
  "/organizations/:organizationId/public-holidays/:id/reactivate",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("leave"),
  requirePermission("public_holiday.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const holidayId = parseId(req.params.id);
    if (isNaN(holidayId)) {
      res.status(400).json({ error: "Invalid holiday ID" });
      return;
    }
    try {
      const holiday = await reactivatePublicHoliday({
        organizationId: req.membership!.organizationId,
        holidayId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(holiday);
    } catch (err) {
      if (err instanceof PublicHolidayNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// DELETE /organizations/:organizationId/public-holidays/:id
router.delete(
  "/organizations/:organizationId/public-holidays/:id",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("leave"),
  requirePermission("public_holiday.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const holidayId = parseId(req.params.id);
    if (isNaN(holidayId)) {
      res.status(400).json({ error: "Invalid holiday ID" });
      return;
    }
    try {
      await deletePublicHoliday({
        organizationId: req.membership!.organizationId,
        holidayId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json({ message: "Public holiday deleted" });
    } catch (err) {
      if (err instanceof PublicHolidayNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

export default router;
