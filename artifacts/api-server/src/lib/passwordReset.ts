import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { generateToken, hashPassword } from "./auth";
import { getEmailProvider } from "./email";
import { logger } from "./logger";

// Shorter than the 7-day invitation TTL (lib/membership.ts) -- this token
// grants control over an existing account, not just an invitation to join one.
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000; // 1 hour

export class PasswordResetTokenNotFoundError extends Error {}
export class PasswordResetTokenExpiredError extends Error {}

export type PasswordResetTokenStatus = "valid" | "expired" | "invalid";

function buildResetEmail(params: { firstName: string; resetUrl: string }) {
  const html = `<p>Hi ${params.firstName},</p><p>We received a request to reset your Enterprise HRMS password. This link expires in 1 hour:</p><p><a href="${params.resetUrl}">${params.resetUrl}</a></p><p>If you didn't request this, you can safely ignore this email.</p>`;
  const text = `Hi ${params.firstName},\n\nWe received a request to reset your Enterprise HRMS password. This link expires in 1 hour:\n${params.resetUrl}\n\nIf you didn't request this, you can safely ignore this email.`;
  return { html, text };
}

/**
 * Requests a password reset for `email`. Always resolves without throwing --
 * an unregistered email and a delivery failure must be indistinguishable to
 * the caller (user enumeration), so both are handled silently here and the
 * route always returns the same generic confirmation. Delivery failures are
 * logged for operators, not surfaced to the client.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const normalized = email.toLowerCase();
  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, normalized)).limit(1);
  if (!user) return;

  const token = generateToken();
  await db
    .update(usersTable)
    .set({
      passwordResetToken: token,
      passwordResetTokenExpiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
    })
    .where(eq(usersTable.id, user.id));

  const appBaseUrl = process.env.APP_BASE_URL;
  if (!appBaseUrl) {
    logger.error("APP_BASE_URL is not set -- cannot build a password reset link");
    return;
  }

  const resetUrl = `${appBaseUrl.replace(/\/$/, "")}/reset-password/${token}`;
  const { html, text } = buildResetEmail({ firstName: user.firstName, resetUrl });

  try {
    await getEmailProvider().send({
      to: user.email,
      subject: "Reset your Enterprise HRMS password",
      html,
      text,
    });
  } catch (err) {
    logger.error({ err, userId: user.id }, "Failed to send password reset email");
  }
}

async function findByToken(token: string) {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.passwordResetToken, token)).limit(1);
  return user ?? null;
}

/** Preview a reset token's validity for the public reset-password page. Does not mutate anything. */
export async function getPasswordResetTokenStatus(token: string): Promise<PasswordResetTokenStatus> {
  const user = await findByToken(token);
  if (!user) return "invalid";
  if (user.passwordResetTokenExpiresAt && user.passwordResetTokenExpiresAt < new Date()) return "expired";
  return "valid";
}

/** Consumes a reset token: sets the new password and clears the token so the link can't be replayed. */
export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const user = await findByToken(token);
  if (!user) throw new PasswordResetTokenNotFoundError("Invalid or already-used reset link");
  if (user.passwordResetTokenExpiresAt && user.passwordResetTokenExpiresAt < new Date()) {
    throw new PasswordResetTokenExpiredError("This reset link has expired");
  }

  await db
    .update(usersTable)
    .set({
      passwordHash: await hashPassword(newPassword),
      passwordResetToken: null,
      passwordResetTokenExpiresAt: null,
    })
    .where(eq(usersTable.id, user.id));
}
