import { Router, type Response, type NextFunction } from "express";
import multer from "multer";
import { eq, and, isNull, inArray } from "drizzle-orm";
import { db, organizationsTable, membershipRolesTable, rolesTable, primaryHrAssignmentsTable } from "@workspace/db";
import { ApplyToInternalVacancyBody } from "@workspace/api-zod";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { getActiveMembershipsForUser, getActiveMembership, resolveActiveOrganizationId } from "../lib/membership";
import { hostnameOrganizationMismatch, shouldFailClosedForTenantResolution } from "../lib/organizationDomains";
import { bindTenantContext } from "../lib/requestContext";
import { requireModuleEnabled } from "../middlewares/requireModuleEnabled";
import type { MembershipRequest } from "../middlewares/requireMembership";
import {
  resolveOwnEmployeeProfile,
  resolveOwnEmploymentHistory,
  resolveOwnSkills,
  resolveOwnQualifications,
  resolveOwnCertifications,
} from "../lib/employeeSelfService";
import { getEmployeeById } from "../lib/employees";
import { resolveOwnEmployeeId } from "../lib/leaveRequests";
import {
  applyEmployeeProfilePicture,
  readEmployeeProfilePictureBuffer,
  clearEmployeeProfilePicture,
  InvalidImageError,
} from "../lib/employeeProfilePicture";
import { RECRUITMENT_MODULE_KEY } from "../lib/recruitmentAuthorization";
import { getNamespaceConfig } from "../services/organizationConfig";
import {
  listInternalVacancies,
  submitInternalApplication,
  listOwnInternalApplications,
  NotLinkedToEmployeeError,
  EmployeeNotActiveError,
  VacancyNotEligibleForInternalApplyError,
  EmployeeMissingEmailError,
} from "../lib/employeeInternalApplications";

const router = Router();
const uploadAvatar = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

/**
 * Every other module-gated route resolves membership from a URL
 * :organizationId (requireMembership). /me/employee has none — Employee
 * Self-Service (W39) is scoped to "the organization the caller is currently
 * working in," per the frozen plan, so this resolves the same way GET /me
 * does (resolveActiveOrganizationId: session's active org if still live,
 * else the legacy home org, else any other active membership) and then
 * independently re-verifies that membership is still live before attaching
 * req.membership, so requireModuleEnabled downstream has something real to
 * check against.
 */
async function requireActiveOrganizationMembership(
  req: MembershipRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const activeOrganizationId = await resolveActiveOrganizationId(
    req.userId!,
    req.session?.activeOrganizationId,
    req.user!.organizationId,
  );
  if (activeOrganizationId == null) {
    res.status(403).json({ error: "No active organization membership" });
    return;
  }

  if (shouldFailClosedForTenantResolution(req.tenantResolutionFailed, false)) {
    res.status(503).json({ error: "Tenant resolution is temporarily unavailable" });
    return;
  }

  if (hostnameOrganizationMismatch(req.resolvedTenantOrganizationId, activeOrganizationId)) {
    res.status(403).json({ error: "No active organization membership" });
    return;
  }

  const membership = await getActiveMembership(req.userId!, activeOrganizationId);
  if (!membership) {
    res.status(403).json({ error: "No active organization membership" });
    return;
  }

  req.membership = membership;
  bindTenantContext(activeOrganizationId, "membership");
  next();
}

// GET /me/organizations
router.get("/me/organizations", requireAuth as any, async (req: AuthenticatedRequest, res): Promise<void> => {
  const memberships = await getActiveMembershipsForUser(req.userId!);

  if (!memberships.length) {
    res.json([]);
    return;
  }

  const organizationIds = memberships.map((m) => m.organizationId);
  const membershipIds = memberships.map((m) => m.id);

  const organizations = await db
    .select()
    .from(organizationsTable)
    .where(inArray(organizationsTable.id, organizationIds));
  const organizationById = new Map(organizations.map((o) => [o.id, o]));

  const roleRows = await db
    .select({ membershipId: membershipRolesTable.membershipId, key: rolesTable.key })
    .from(membershipRolesTable)
    .innerJoin(rolesTable, eq(membershipRolesTable.roleId, rolesTable.id))
    .where(inArray(membershipRolesTable.membershipId, membershipIds));
  const rolesByMembership = new Map<number, string[]>();
  for (const row of roleRows) {
    const list = rolesByMembership.get(row.membershipId) ?? [];
    list.push(row.key);
    rolesByMembership.set(row.membershipId, list);
  }

  const primaryHrRows = await db
    .select({ membershipId: primaryHrAssignmentsTable.membershipId })
    .from(primaryHrAssignmentsTable)
    .where(
      and(
        inArray(primaryHrAssignmentsTable.membershipId, membershipIds),
        isNull(primaryHrAssignmentsTable.revokedAt),
      ),
    );
  const primaryHrMembershipIds = new Set(primaryHrRows.map((r) => r.membershipId));

  // WWM Presentation Readiness: the authenticated shell's own branding
  // (systemDisplayName) is sourced from the caller's actual active
  // organization here, rather than depending on GET /tenant-context's
  // hostname resolution — correct even for a super_admin whose active
  // organization differs from the hostname they happen to be browsing.
  const distinctOrgIds = [...new Set(organizations.map((o) => o.id))];
  const brandingByOrgId = new Map(
    await Promise.all(
      distinctOrgIds.map(async (id) => [id, (await getNamespaceConfig(id, "branding")).data.systemDisplayName] as const),
    ),
  );

  const summaries = memberships
    .map((membership) => {
      const organization = organizationById.get(membership.organizationId);
      if (!organization) return null;
      const systemDisplayName = brandingByOrgId.get(organization.id);
      return {
        organizationId: organization.id,
        organizationName: organization.name,
        organizationSlug: organization.slug,
        logoUrl: organization.logoUrl,
        systemDisplayName: typeof systemDisplayName === "string" ? systemDisplayName : null,
        status: membership.status,
        roles: rolesByMembership.get(membership.id) ?? [],
        isPrimaryHr: primaryHrMembershipIds.has(membership.id),
      };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);

  res.json(summaries);
});

// GET /me/employee
// Employee Self-Service (W39): resolves the caller's own linked employee for
// their currently active organization only — never a client-supplied
// employeeId, never another organization's data (see
// lib/employeeSelfService.ts). An unlinked user is not an error: `linked:
// false` is the intentional, safe response the frontend renders as a
// "contact your HR administrator" state, not a 404/500.
router.get(
  "/me/employee",
  requireAuth as any,
  requireActiveOrganizationMembership,
  requireModuleEnabled("employee_self_service"),
  async (req: MembershipRequest, res): Promise<void> => {
    const profile = await resolveOwnEmployeeProfile(req.membership!.organizationId, req.userId!);
    res.json({ linked: profile != null, employee: profile });
  },
);

// POST /me/employee/profile-picture, GET, DELETE
// Lets a caller set/view/remove their own profile picture without needing
// the HR-administrator employee.write/employee.read permission — identity
// is always server-resolved via resolveOwnEmployeeId (see GET /me/employee's
// own header comment), never a client-supplied employeeId. Shares the exact
// same storage/processing implementation as the HR admin routes in
// routes/employees.ts (lib/employeeProfilePicture.ts) — one picture per
// employee record, not a second parallel concept.
router.post(
  "/me/employee/profile-picture",
  requireAuth as any,
  requireActiveOrganizationMembership,
  requireModuleEnabled("employee_self_service"),
  uploadAvatar.single("file"),
  async (req: MembershipRequest, res): Promise<void> => {
    if (!req.file) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }

    const organizationId = req.membership!.organizationId;
    const employeeId = await resolveOwnEmployeeId(organizationId, req.userId!);
    if (employeeId == null) {
      res.status(403).json({ error: "No linked employee record" });
      return;
    }
    const employee = await getEmployeeById(organizationId, employeeId);
    if (!employee) {
      res.status(403).json({ error: "No linked employee record" });
      return;
    }

    try {
      await applyEmployeeProfilePicture(
        organizationId,
        employee,
        { mimetype: req.file.mimetype, size: req.file.size, buffer: req.file.buffer },
        req.userId!,
      );
      const profile = await resolveOwnEmployeeProfile(organizationId, req.userId!);
      res.json({ linked: profile != null, employee: profile });
    } catch (err) {
      if (err instanceof InvalidImageError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

router.get(
  "/me/employee/profile-picture",
  requireAuth as any,
  requireActiveOrganizationMembership,
  requireModuleEnabled("employee_self_service"),
  async (req: MembershipRequest, res): Promise<void> => {
    const organizationId = req.membership!.organizationId;
    const employeeId = await resolveOwnEmployeeId(organizationId, req.userId!);
    const employee = employeeId != null ? await getEmployeeById(organizationId, employeeId) : null;
    const buffer = employee ? await readEmployeeProfilePictureBuffer(organizationId, employee) : null;
    if (!buffer) {
      res.status(404).json({ error: "No profile picture" });
      return;
    }

    res.set("Content-Type", "image/jpeg");
    res.set("Cache-Control", "private, max-age=300");
    res.send(buffer);
  },
);

router.delete(
  "/me/employee/profile-picture",
  requireAuth as any,
  requireActiveOrganizationMembership,
  requireModuleEnabled("employee_self_service"),
  async (req: MembershipRequest, res): Promise<void> => {
    const organizationId = req.membership!.organizationId;
    const employeeId = await resolveOwnEmployeeId(organizationId, req.userId!);
    if (employeeId == null) {
      res.status(403).json({ error: "No linked employee record" });
      return;
    }
    const employee = await getEmployeeById(organizationId, employeeId);
    if (!employee) {
      res.status(403).json({ error: "No linked employee record" });
      return;
    }

    await clearEmployeeProfilePicture(organizationId, employee, req.userId!);
    const profile = await resolveOwnEmployeeProfile(organizationId, req.userId!);
    res.json({ linked: profile != null, employee: profile });
  },
);

// GET /me/employment-history
// Employee Self-Service Career Profile foundation (Phase 3F, W105): the
// caller's own internal employment history (transfer/promotion/confirmation
// events) — reuses W22's employment_periods verbatim, no new table, no new
// permission. Own identity always server-resolved (see
// lib/employeeSelfService.ts's own resolveOwnEmploymentHistory) — never a
// client-supplied employeeId. Gated identically to GET /me/employee.
router.get(
  "/me/employment-history",
  requireAuth as any,
  requireActiveOrganizationMembership,
  requireModuleEnabled("employee_self_service"),
  async (req: MembershipRequest, res): Promise<void> => {
    const history = await resolveOwnEmploymentHistory(req.membership!.organizationId, req.userId!);
    res.json(history);
  },
);

// GET /me/skills, /me/qualifications, /me/certifications
// Career Profile (Phase 3F, W106): own-scoped reads over the existing
// employee_skills/employee_qualifications/employee_certifications tables
// (Phase 2A, W24), gated and shaped identically to GET /me/employment-history
// above — no permission key, own identity always server-resolved. Career
// Profile's Certifications section deliberately reads employee_certifications
// only; learning_certificates (Phase 3D) remains My Learning's own exclusive
// surface, never read here (Learning's own frozen Owner Decision 3).
router.get(
  "/me/skills",
  requireAuth as any,
  requireActiveOrganizationMembership,
  requireModuleEnabled("employee_self_service"),
  async (req: MembershipRequest, res): Promise<void> => {
    const skills = await resolveOwnSkills(req.membership!.organizationId, req.userId!);
    res.json(skills);
  },
);

router.get(
  "/me/qualifications",
  requireAuth as any,
  requireActiveOrganizationMembership,
  requireModuleEnabled("employee_self_service"),
  async (req: MembershipRequest, res): Promise<void> => {
    const qualifications = await resolveOwnQualifications(req.membership!.organizationId, req.userId!);
    res.json(qualifications);
  },
);

router.get(
  "/me/certifications",
  requireAuth as any,
  requireActiveOrganizationMembership,
  requireModuleEnabled("employee_self_service"),
  async (req: MembershipRequest, res): Promise<void> => {
    const certifications = await resolveOwnCertifications(req.membership!.organizationId, req.userId!);
    res.json(certifications);
  },
);

function handleInternalApplicationError(err: unknown, res: Response): boolean {
  if (err instanceof NotLinkedToEmployeeError || err instanceof EmployeeNotActiveError) {
    res.status(403).json({ error: err.message });
    return true;
  }
  if (err instanceof VacancyNotEligibleForInternalApplyError) {
    res.status(404).json({ error: err.message });
    return true;
  }
  if (err instanceof EmployeeMissingEmailError) {
    res.status(400).json({ error: err.message });
    return true;
  }
  return false;
}

// GET /me/internal-vacancies
// Employee Self-Service Internal Applications (W60): gated on both
// employee_self_service and recruitment independently (§8) — the ESS page
// itself only needs employee_self_service; this section additionally,
// independently requires recruitment, so a disabled recruitment module
// degrades only this one section on the frontend, never the whole page.
router.get(
  "/me/internal-vacancies",
  requireAuth as any,
  requireActiveOrganizationMembership,
  requireModuleEnabled("employee_self_service"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  async (req: MembershipRequest, res): Promise<void> => {
    const result = await listInternalVacancies(req.membership!.organizationId, req.userId!);
    res.json(result);
  },
);

// POST /me/internal-vacancies/:publicId/apply
router.post(
  "/me/internal-vacancies/:publicId/apply",
  requireAuth as any,
  requireActiveOrganizationMembership,
  requireModuleEnabled("employee_self_service"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  async (req: MembershipRequest, res): Promise<void> => {
    const publicIdRaw = Array.isArray(req.params.publicId) ? req.params.publicId[0] : req.params.publicId;
    const parsed = ApplyToInternalVacancyBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const result = await submitInternalApplication({
        organizationId: req.membership!.organizationId,
        applicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
        vacancyPublicId: publicIdRaw,
        answers: parsed.data.answers,
      });
      res.status(201).json({ id: result.application.id, isNew: result.isNew, status: "submitted" });
    } catch (err) {
      if (handleInternalApplicationError(err, res)) return;
      throw err;
    }
  },
);

// GET /me/applications
router.get(
  "/me/applications",
  requireAuth as any,
  requireActiveOrganizationMembership,
  requireModuleEnabled("employee_self_service"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  async (req: MembershipRequest, res): Promise<void> => {
    const result = await listOwnInternalApplications(req.membership!.organizationId, req.userId!);
    res.json(result);
  },
);

export default router;
