/**
 * WS-6 (§33-34) — the platform operational surface for the scheduler.
 * Reserved to the platform super_admin, mirroring installations.ts's own
 * requireAuth + requireSuperAdmin pattern exactly: no requireMembership,
 * since scheduled_jobs is platform-wide operational data spanning every
 * organization, not a per-organization management resource.
 *
 * There is deliberately no generic "execute job" or "create arbitrary job"
 * endpoint here (§33/§70) — domain APIs create jobs through their own
 * server-side calls to `scheduleJob()`, never through a route a client can
 * invoke directly with an arbitrary jobType/payload. Everything below is
 * read, cancel-a-pending-job, reschedule-a-pending-job, or retry-a-failed-
 * job — never "run this job type with this payload right now."
 */
import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { requireSuperAdmin } from "../middlewares/requireSuperAdmin";
import {
  listScheduledJobs,
  getScheduledJob,
  cancelJob,
  rescheduleJob,
  retryFailedJob,
  ScheduledJobNotFoundError,
  JobNotCancellableError,
  JobNotReschedulableError,
  JobNotRetryableError,
} from "../lib/scheduledJobs";
import type { AuthenticatedRequest } from "../middlewares/requireAuth";
import type { Response } from "express";

const router = Router();

function parseId(raw: unknown): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const id = parseInt(value as string, 10);
  return isNaN(id) ? null : id;
}

function handleError(err: unknown, res: Response): void {
  if (err instanceof ScheduledJobNotFoundError) {
    res.status(404).json({ error: err.message });
    return;
  }
  if (err instanceof JobNotCancellableError || err instanceof JobNotReschedulableError || err instanceof JobNotRetryableError) {
    res.status(409).json({ error: err.message });
    return;
  }
  throw err;
}

const STATUS_VALUES = ["scheduled", "running", "completed", "failed", "cancelled"] as const;

// GET /platform/scheduled-jobs
router.get("/platform/scheduled-jobs", requireAuth as any, requireSuperAdmin, async (req, res): Promise<void> => {
  const status = typeof req.query.status === "string" && (STATUS_VALUES as readonly string[]).includes(req.query.status) ? (req.query.status as (typeof STATUS_VALUES)[number]) : undefined;
  const organizationId = typeof req.query.organizationId === "string" ? parseInt(req.query.organizationId, 10) : undefined;
  const jobType = typeof req.query.jobType === "string" ? req.query.jobType : undefined;
  const limit = typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : undefined;
  const offset = typeof req.query.offset === "string" ? parseInt(req.query.offset, 10) : undefined;

  const jobs = await listScheduledJobs({
    status,
    organizationId: organizationId != null && !isNaN(organizationId) ? organizationId : undefined,
    jobType,
    limit: limit != null && !isNaN(limit) ? limit : undefined,
    offset: offset != null && !isNaN(offset) ? offset : undefined,
  });
  res.json(jobs);
});

// GET /platform/scheduled-jobs/:id
router.get("/platform/scheduled-jobs/:id", requireAuth as any, requireSuperAdmin, async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (id === null) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }
  const job = await getScheduledJob(id);
  if (!job) {
    res.status(404).json({ error: "Scheduled job not found" });
    return;
  }
  res.json(job);
});

// POST /platform/scheduled-jobs/:id/cancel
router.post(
  "/platform/scheduled-jobs/:id/cancel",
  requireAuth as any,
  requireSuperAdmin,
  async (req: AuthenticatedRequest, res): Promise<void> => {
    const id = parseId(req.params.id);
    if (id === null) {
      res.status(400).json({ error: "Invalid ID" });
      return;
    }
    try {
      res.json(await cancelJob({ jobId: id, actorApplicationUserId: req.userId!, actorMembershipId: null }));
    } catch (err) {
      handleError(err, res);
    }
  },
);

// POST /platform/scheduled-jobs/:id/reschedule
router.post(
  "/platform/scheduled-jobs/:id/reschedule",
  requireAuth as any,
  requireSuperAdmin,
  async (req: AuthenticatedRequest, res): Promise<void> => {
    const id = parseId(req.params.id);
    const scheduledFor = typeof req.body?.scheduledFor === "string" ? new Date(req.body.scheduledFor) : null;
    if (id === null || !scheduledFor || isNaN(scheduledFor.getTime())) {
      res.status(400).json({ error: "A valid scheduledFor (ISO date-time) is required" });
      return;
    }
    try {
      res.json(await rescheduleJob({ jobId: id, scheduledFor, actorApplicationUserId: req.userId!, actorMembershipId: null }));
    } catch (err) {
      handleError(err, res);
    }
  },
);

// POST /platform/scheduled-jobs/:id/retry
router.post(
  "/platform/scheduled-jobs/:id/retry",
  requireAuth as any,
  requireSuperAdmin,
  async (req: AuthenticatedRequest, res): Promise<void> => {
    const id = parseId(req.params.id);
    if (id === null) {
      res.status(400).json({ error: "Invalid ID" });
      return;
    }
    try {
      res.json(await retryFailedJob({ jobId: id, actorApplicationUserId: req.userId!, actorMembershipId: null }));
    } catch (err) {
      handleError(err, res);
    }
  },
);

export default router;
