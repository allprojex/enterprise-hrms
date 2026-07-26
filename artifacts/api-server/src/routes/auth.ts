import { Router } from "express";
import rateLimit from "express-rate-limit";
import { eq } from "drizzle-orm";
import { db, usersTable, sessionsTable } from "@workspace/db";
import { LoginBody, ForgotPasswordBody, SwitchOrganizationBody } from "@workspace/api-zod";
import { hashPassword, verifyPassword, generateToken } from "../lib/auth";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { getActiveMembership, resolveActiveOrganizationId } from "../lib/membership";
import { recordAuditEvent } from "../lib/auditLog";

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
router.post("/auth/login", loginRateLimiter, async (req, res): Promise<void> => {
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

  const token = generateToken();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  await db.insert(sessionsTable).values({ token, userId: user.id, expiresAt });

  const activeOrganizationId = await resolveActiveOrganizationId(user.id, null, user.organizationId);

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
  // In a real app: send reset email. For the shell, we just confirm.
  res.json({ message: "If that email is registered, a reset link has been sent." });
});

// POST /auth/switch-organization
router.post(
  "/auth/switch-organization",
  requireAuth as any,
  async (req: AuthenticatedRequest, res): Promise<void> => {
    const parsed = SwitchOrganizationBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const { organizationId } = parsed.data;
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
