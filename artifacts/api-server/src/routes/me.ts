import { Router, type Response, type NextFunction } from "express";
import { eq, and, isNull, inArray } from "drizzle-orm";
import { db, organizationsTable, membershipRolesTable, rolesTable, primaryHrAssignmentsTable } from "@workspace/db";
import { ApplyToInternalVacancyBody } from "@workspace/api-zod";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { getActiveMembershipsForUser, getActiveMembership, resolveActiveOrganizationId } from "../lib/membership";
import { hostnameOrganizationMismatch } from "../lib/organizationDomains";
import { requireModuleEnabled } from "../middlewares/requireModuleEnabled";
import type { MembershipRequest } from "../middlewares/requireMembership";
import { resolveOwnEmployeeProfile } from "../lib/employeeSelfService";
import { RECRUITMENT_MODULE_KEY } from "../lib/recruitmentAuthorization";
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

  const summaries = memberships
    .map((membership) => {
      const organization = organizationById.get(membership.organizationId);
      if (!organization) return null;
      return {
        organizationId: organization.id,
        organizationName: organization.name,
        organizationSlug: organization.slug,
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
