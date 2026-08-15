import { Router } from "express";
import rateLimit from "express-rate-limit";
import { eq } from "drizzle-orm";
import { db, usersTable, sessionsTable } from "@workspace/db";
import { LoginBody, ForgotPasswordBody, SwitchOrganizationBody, ResetPasswordBody } from "@workspace/api-zod";
import { hashPassword, verifyPassword, generateToken } from "../lib/auth";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import type { TenantAwareRequest } from "../middlewares/resolveTenantHost";
import { getActiveMembership, resolveActiveOrganizationId } from "../lib/membership";
import { recordAuditEvent } from "../lib/auditLog";
import { isSuperAdmin } from "../lib/authorization";
import { shouldFailClosedForTenantResolution } from "../lib/organizationDomains";
import {
  requestPasswordReset,
  getPasswordResetTokenStatus,
  resetPassword,
  PasswordResetTokenNotFoundError,
  PasswordResetTokenExpiredError,
} from "../lib/passwordReset";

const router = Router();

// Limits brute-force password guessing per IP; does not change the auth
// model itself, just throttles how often /auth/login can be called.
const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please try again later." },
});

function formatUser(user: typeof usersTable.$inferSelect, activeOrganizationId: number | null) {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    organizationId: user.organizationId,
    activeOrganizationId,
    avatarUrl: user.avatarUrl,
    jobTitle: user.jobTitle,
    department: user.department,
    phoneNumber: user.phoneNumber,
    createdAt: user.createdAt,
  };
}

// POST /auth/login
router.post("/auth/login", loginRateLimiter, async (req: TenantAwareRequest, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { email, password } = parsed.data;

  const users = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email.toLowerCase()))
    .limit(1);

  if (!users.length) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const user = users[0];
  const valid = await verifyPassword(password, user.passwordHash);

  if (!valid) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  // Multi-Organization Tenant Infrastructure: a resolved tenant hostname
  // (e.g. acme.example-hrms.com) never grants login on its own, but it does
  // deny one — a WWM-only account cannot log in from Acme's hostname, and
  // vice versa. super_admin is exempt, the same platform-wide bypass this
  // codebase already applies everywhere else (isSuperAdmin). If tenant
  // resolution itself failed (a database error, not a clean "no tenant
  // bound to this hostname"), fail closed for everyone else too — an
  // infrastructure failure must never be indistinguishable from "this
  // hostname carries no tenant restriction."
  if (shouldFailClosedForTenantResolution(req.tenantResolutionFailed, isSuperAdmin(user))) {
    res.status(503).json({ error: "Tenant resolution is temporarily unavailable" });
    return;
  }

  let tenantOrganizationId: number | null = null;
  const resolvedTenant = req.resolvedTenantOrganizationId;
  if (resolvedTenant != null && !isSuperAdmin(user)) {
    const tenantMembership = await getActiveMembership(user.id, resolvedTenant);
    if (!tenantMembership) {
      res.status(403).json({ error: "This account does not have access to this organization" });
      return;
    }
    tenantOrganizationId = resolvedTenant;
  }

  const token = generateToken();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  await db.insert(sessionsTable).values({ token, userId: user.id, expiresAt, activeOrganizationId: tenantOrganizationId });

  const activeOrganizationId = await resolveActiveOrganizationId(user.id, tenantOrganizationId, user.organizationId);

  res.json({ user: formatUser(user, activeOrganizationId), token });
});

// POST /auth/logout
router.post("/auth/logout", requireAuth as any, async (req: AuthenticatedRequest, res): Promise<void> => {
  const authHeader = req.headers.authorization!;
  const token = authHeader.slice(7);
  await db.delete(sessionsTable).where(eq(sessionsTable.token, token));
  res.json({ message: "Logged out successfully" });
});

// POST /auth/forgot-password
router.post("/auth/forgot-password", async (req, res): Promise<void> => {
  const parsed = ForgotPasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  await requestPasswordReset(parsed.data.email);

  // Always the same response regardless of whether the email is registered
  // or delivery succeeded -- see requestPasswordReset's doc comment.
  res.json({ message: "If that email is registered, a reset link has been sent." });
});

// GET /auth/reset-password/:token
// Public -- no authentication required. Used by the reset-password page.
router.get("/auth/reset-password/:token", async (req, res): Promise<void> => {
  const token = Array.isArray(req.params.token) ? req.params.token[0] : req.params.token;
  const status = await getPasswordResetTokenStatus(token);
  res.json({ status });
});

// POST /auth/reset-password/:token
// Public -- no authentication required. Sets a new password and consumes the token.
router.post("/auth/reset-password/:token", async (req, res): Promise<void> => {
  const token = Array.isArray(req.params.token) ? req.params.token[0] : req.params.token;

  const parsed = ResetPasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    await resetPassword(token, parsed.data.password);
    res.json({ message: "Password reset. You can now log in." });
  } catch (err) {
    if (err instanceof PasswordResetTokenNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    if (err instanceof PasswordResetTokenExpiredError) {
      res.status(410).json({ error: err.message });
      return;
    }
    throw err;
  }
});

// POST /auth/switch-organization
router.post(
  "/auth/switch-organization",
  requireAuth as any,
  async (req: AuthenticatedRequest & TenantAwareRequest, res): Promise<void> => {
    const parsed = SwitchOrganizationBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const { organizationId } = parsed.data;

    // If tenant resolution itself failed (a database error, not a clean "no
    // tenant bound to this hostname"), fail closed rather than silently
    // allowing the switch as if hostname were irrelevant. super_admin is
    // exempt, the same platform-wide bypass applied to the mismatch check
    // just below.
    if (shouldFailClosedForTenantResolution(req.tenantResolutionFailed, isSuperAdmin(req.user!))) {
      res.status(503).json({ error: "Tenant resolution is temporarily unavailable" });
      return;
    }

    // Do not automatically switch tenants merely because a hostname was
    // changed, and never let a hostname be used to switch into a
    // different organization than the one it's bound to.
    if (
      req.resolvedTenantOrganizationId != null &&
      req.resolvedTenantOrganizationId !== organizationId &&
      !isSuperAdmin(req.user!)
    ) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const membership = await getActiveMembership(req.userId!, organizationId);
    if (!membership) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const token = req.headers.authorization!.slice(7);
    await db.update(sessionsTable).set({ activeOrganizationId: organizationId }).where(eq(sessionsTable.token, token));

    await recordAuditEvent({
      actorApplicationUserId: req.userId!,
      actorMembershipId: membership.id,
      organizationId,
      eventType: "session.org_switch",
      targetType: "session",
      targetId: null,
    });

    res.json({ message: "Active organization switched" });
  },
);

// GET /auth/me
router.get("/auth/me", requireAuth as any, async (req: AuthenticatedRequest, res): Promise<void> => {
  const activeOrganizationId = await resolveActiveOrganizationId(
    req.userId!,
    req.session?.activeOrganizationId,
    req.user!.organizationId,
  );
  res.json(formatUser(req.user!, activeOrganizationId));
});

export { hashPassword };
export default router;
