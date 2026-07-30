/**
 * Public Careers Portal routes (Phase 3A, W49). No `requireAuth`/
 * `requireMembership`/`requireModuleEnabled` anywhere in this file — these
 * are genuinely public, unauthenticated surfaces (docs/PHASE_3A_RECRUITMENT_IMPLEMENTATION_PLAN.md
 * §6), the first of their kind in this codebase (every prior public route —
 * `/auth/reset-password/:token`, `/invitations/:token` — is single-purpose
 * and token-gated). Every route independently resolves its own organization
 * by `slug` via `resolvePublicOrganization`, never trusting a path segment
 * as pre-validated.
 */
import { Router } from "express";
import multer from "multer";
import rateLimit from "express-rate-limit";
import {
  resolvePublicOrganization,
  listPublicVacancies,
  getPublicVacancyByPublicId,
  resolveEligibleVacancyForApply,
} from "../lib/publicCareers";
import { submitPublicApplication, getApplicationStatusByToken, ApplicationLimitExceededError, InvalidDocumentError } from "../lib/candidateApplications";
import { generateToken } from "../lib/auth";

const router = Router();

const uploadResume = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// The apply endpoint is the highest-risk public route in this codebase
// (§6) — a real payload (file upload) plus PII capture. A stricter window
// than /auth/login's loginRateLimiter (10/15min) given the larger cost per
// request.
const applyRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many applications submitted. Please try again later." },
});

// Guards against brute-forcing a status-check token by trying many values.
const statusCheckRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many status checks. Please try again later." },
});

function parseOptionalInt(raw: unknown): number | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string" || value === "") return undefined;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? undefined : parsed;
}

function parseOptionalString(raw: unknown): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

/**
 * `answers` (W52) arrives as a JSON-encoded string field alongside the
 * resume file in the same multipart request — multipart/form-data has no
 * native way to carry a nested array of objects. Malformed or missing
 * input is silently treated as "no answers" rather than failing the whole
 * submission over one optional field.
 */
function parseAnswers(raw: unknown): { vacancyQuestionId: number; answerText: string }[] {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string" || value.trim() === "") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((a): a is { vacancyQuestionId: unknown; answerText: unknown } => typeof a === "object" && a !== null)
      .map((a) => ({ vacancyQuestionId: Number(a.vacancyQuestionId), answerText: String(a.answerText ?? "") }))
      .filter((a) => Number.isFinite(a.vacancyQuestionId) && a.answerText.trim() !== "");
  } catch {
    return [];
  }
}

// GET /careers/:orgSlug
router.get("/careers/:orgSlug", async (req, res): Promise<void> => {
  const org = await resolvePublicOrganization(String(req.params.orgSlug));
  if (!org) {
    res.status(404).json({ error: "Careers page not available" });
    return;
  }
  res.json({ slug: org.slug, name: org.name, logoUrl: org.logoUrl });
});

// GET /careers/:orgSlug/vacancies
router.get("/careers/:orgSlug/vacancies", async (req, res): Promise<void> => {
  const org = await resolvePublicOrganization(String(req.params.orgSlug));
  if (!org) {
    res.status(404).json({ error: "Careers page not available" });
    return;
  }

  const page = Math.max(1, parseOptionalInt(req.query.page) ?? 1);
  const pageSize = Math.min(50, Math.max(1, parseOptionalInt(req.query.pageSize) ?? 20));

  const result = await listPublicVacancies({
    organizationId: org.id,
    search: parseOptionalString(req.query.search),
    department: parseOptionalString(req.query.department),
    location: parseOptionalString(req.query.location),
    employmentType: parseOptionalString(req.query.employmentType),
    workplaceType: parseOptionalString(req.query.workplaceType),
    page,
    pageSize,
  });

  res.json({ ...result, page, pageSize });
});

// GET /careers/:orgSlug/jobs/:vacancyPublicId
router.get("/careers/:orgSlug/jobs/:vacancyPublicId", async (req, res): Promise<void> => {
  const org = await resolvePublicOrganization(String(req.params.orgSlug));
  if (!org) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  const vacancy = await getPublicVacancyByPublicId(org.id, String(req.params.vacancyPublicId));
  if (!vacancy) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  res.json(vacancy);
});

// POST /careers/:orgSlug/jobs/:vacancyPublicId/apply
router.post(
  "/careers/:orgSlug/jobs/:vacancyPublicId/apply",
  applyRateLimiter,
  uploadResume.single("resume"),
  async (req, res): Promise<void> => {
    const org = await resolvePublicOrganization(String(req.params.orgSlug));
    if (!org) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    const vacancy = await resolveEligibleVacancyForApply(org.id, String(req.params.vacancyPublicId));
    if (!vacancy) {
      res.status(404).json({ error: "Job not found" });
      return;
    }

    // Honeypot: a real applicant never sees or fills this field (hidden via
    // CSS on the form). A bot that fills every field gets the exact same
    // success response as a genuine applicant, with nothing persisted --
    // never reveals to an automated submitter that it was detected.
    const honeypot = parseOptionalString(req.body?.website);
    if (honeypot) {
      // Same response shape as a genuine success (including a throwaway
      // publicId) -- nothing is persisted, and an automated submitter gets
      // no signal that it was detected.
      res.status(201).json({ submitted: true, publicId: generateToken() });
      return;
    }

    const firstName = parseOptionalString(req.body?.firstName);
    const lastName = parseOptionalString(req.body?.lastName);
    const email = parseOptionalString(req.body?.email);
    const phone = parseOptionalString(req.body?.phone) ?? null;
    if (!firstName || !lastName || !email || !req.file) {
      res.status(400).json({ error: "firstName, lastName, email, and a resume file are required" });
      return;
    }

    try {
      const { application, isNew } = await submitPublicApplication({
        organizationId: org.id,
        organizationSlug: org.slug,
        organizationName: org.name,
        vacancyId: vacancy.id,
        vacancyPublicId: vacancy.publicId,
        vacancyTitle: vacancy.title,
        firstName,
        lastName,
        email,
        phone,
        resumeFile: { mimetype: req.file.mimetype, size: req.file.size, buffer: req.file.buffer, originalname: req.file.originalname },
        answers: parseAnswers(req.body?.answers),
      });
      res.status(isNew ? 201 : 200).json({ submitted: true, publicId: application.publicId });
    } catch (err) {
      if (err instanceof InvalidDocumentError) {
        res.status(400).json({ error: err.message });
        return;
      }
      if (err instanceof ApplicationLimitExceededError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// GET /careers/:orgSlug/application-status/:token
router.get("/careers/:orgSlug/application-status/:token", statusCheckRateLimiter, async (req, res): Promise<void> => {
  const org = await resolvePublicOrganization(String(req.params.orgSlug));
  if (!org) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const result = await getApplicationStatusByToken(org.id, String(req.params.token));
  if (!result.found) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json({ vacancyTitle: result.vacancyTitle, submittedAt: result.submittedAt, status: "submitted" });
});

export default router;
