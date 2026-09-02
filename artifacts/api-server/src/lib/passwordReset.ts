import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db, usersTable, sessionsTable } from "@workspace/db";
import { generateToken, hashPassword } from "./auth";
import { getEmailProvider } from "./email";
import { logger } from "./logger";

// Shorter than the 7-day invitation TTL (lib/membership.ts) -- this token
// grants control over an existing account, not just an invitation to join one.
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000; // 1 hour

export class PasswordResetTokenNotFoundError extends Error {}
export class PasswordResetTokenExpiredError extends Error {}

export type PasswordResetTokenStatus = "valid" | "expired" | "invalid";

/**
 * WS-18 Pass 2, F-2 — reset tokens are stored as a SHA-256 digest, never in
 * plaintext.
 *
 * The token is a password-equivalent secret: whoever holds it can take over the
 * account without knowing the current password. Storing it verbatim meant that
 * any read of the `users` table — a support query, a logical backup, a
 * misdirected export, a future reporting join — handed over live account-takeover
 * material for every user with a reset in flight. Storing the digest means a
 * reader of the column learns nothing usable; only the holder of the emailed
 * token can produce a matching digest.
 *
 * SHA-256 unsalted is the right primitive here, unlike for passwords: the input
 * is 256 bits of `crypto.randomBytes` entropy, so there is no dictionary to
 * attack and no benefit from a slow KDF. Lookup by digest also stays a single
 * indexed equality match, exactly as before.
 *
 * Migration note: this changes the representation, not the schema — the column
 * is already text of ample width. Tokens issued before this change no longer
 * match and will read as `invalid`. That is an acceptable one-time effect: the
 * TTL is one hour, so the affected window is at most the hour around deployment,
 * and the recovery is for the user to request a new link.
 */
function digestToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

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
 *
 * WS-18 Pass 2, F-2: email delivery is dispatched WITHOUT being awaited. It
 * previously blocked the response, which made a registered address take as long
 * as an outbound SMTP/API round-trip while an unregistered one returned after a
 * single missed SELECT — an account-enumeration oracle measurable with a
 * stopwatch, regardless of how carefully the response body was equalized. The
 * caller pairs this with a minimum response duration (see
 * `padToMinimumDuration`) to absorb the remaining database-write difference.
 *
 * Nothing about the returned promise reveals whether the address matched: it
 * resolves identically either way.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const normalized = email.toLowerCase();
  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, normalized)).limit(1);
  if (!user) return;

  const token = generateToken();
  await db
    .update(usersTable)
    .set({
      passwordResetToken: digestToken(token),
      passwordResetTokenExpiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
    })
    .where(eq(usersTable.id, user.id));

  const appBaseUrl = process.env.APP_BASE_URL;
  if (!appBaseUrl) {
    logger.error("APP_BASE_URL is not set -- cannot build a password reset link");
    return;
  }

  // The plaintext token appears here, in the URL, and in the outbound email --
  // and nowhere else. It is never logged and never persisted.
  const resetUrl = `${appBaseUrl.replace(/\/$/, "")}/reset-password/${token}`;
  const { html, text } = buildResetEmail({ firstName: user.firstName, resetUrl });

  // WS-18 Pass 3, finding WS18-P3-06 — EVERYTHING about delivery is contained
  // here, including the provider lookup itself.
  //
  // `getEmailProvider()` throws synchronously (EmailNotConfiguredError) when
  // RESEND_API_KEY / EMAIL_FROM_ADDRESS are unset. Calling it outside a
  // try/catch meant that on a deployment without email configured, a REGISTERED
  // address produced a 500 while an unregistered one returned 200 — a perfect
  // account-enumeration oracle, and a worse one than the timing difference this
  // non-blocking dispatch was introduced to remove. Live DAST against the
  // disposable stack caught it.
  //
  // No delivery failure of any kind — misconfiguration, provider outage,
  // rejected recipient — may change what this function does from the caller's
  // point of view. It always resolves, silently, exactly as the doc comment
  // above promises.
  try {
    void getEmailProvider()
      .send({
        to: user.email,
        subject: "Reset your Enterprise HRMS password",
        html,
        text,
      })
      // Logged by user id only. The token, the reset URL, and the recipient
      // address are all deliberately excluded: operational logs are a far wider
      // audience than the mailbox the link was sent to.
      .catch((err: unknown) => {
        logger.error({ err, userId: user.id }, "Failed to send password reset email");
      });
  } catch (err) {
    logger.error({ err, userId: user.id }, "Password reset email could not be dispatched");
  }
}

async function findByToken(token: string) {
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.passwordResetToken, digestToken(token)))
    .limit(1);
  return user ?? null;
}

/** Preview a reset token's validity for the public reset-password page. Does not mutate anything. */
export async function getPasswordResetTokenStatus(token: string): Promise<PasswordResetTokenStatus> {
  const user = await findByToken(token);
  if (!user) return "invalid";
  if (user.passwordResetTokenExpiresAt && user.passwordResetTokenExpiresAt < new Date()) return "expired";
  return "valid";
}

/**
 * Consumes a reset token: sets the new password, clears the token so the link
 * can't be replayed, and revokes every existing session for the account.
 *
 * WS-18 Pass 2, F-2 — the session revocation is new and is the point of the
 * whole flow. Password reset is the control a user reaches for *because* they
 * believe their account is compromised. Leaving previously issued session tokens
 * valid meant that reset did not actually evict an attacker: a stolen bearer
 * token kept working afterwards, and the victim had no way to tell. Revocation
 * uses the same `sessionsTable` delete that `lib/userDisablement.ts` already
 * performs when an account is disabled, so this is the established identity
 * primitive being applied to the case that most needs it, not a second
 * mechanism.
 *
 * This intentionally revokes ALL sessions, including any belonging to the person
 * performing the reset. Re-authenticating with the password they just chose is a
 * trivial cost; leaving one live session behind on the theory that it is
 * probably the legitimate user is exactly the assumption an attacker relies on.
 *
 * The password update and the revocation run in a single transaction so the
 * account can never end up with the new password accepted but old sessions still
 * live.
 */
export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const user = await findByToken(token);
  if (!user) throw new PasswordResetTokenNotFoundError("Invalid or already-used reset link");
  if (user.passwordResetTokenExpiresAt && user.passwordResetTokenExpiresAt < new Date()) {
    throw new PasswordResetTokenExpiredError("This reset link has expired");
  }

  const passwordHash = await hashPassword(newPassword);

  await db.transaction(async (tx) => {
    await tx
      .update(usersTable)
      .set({
        passwordHash,
        passwordResetToken: null,
        passwordResetTokenExpiresAt: null,
      })
      .where(eq(usersTable.id, user.id));

    await tx.delete(sessionsTable).where(eq(sessionsTable.userId, user.id));
  });
}
