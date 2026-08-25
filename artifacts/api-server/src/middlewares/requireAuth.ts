import { Request, Response, NextFunction } from "express";
import { db, sessionsTable, usersTable } from "@workspace/db";
import { eq, and, gt } from "drizzle-orm";

export interface AuthenticatedRequest extends Request {
  userId?: number;
  user?: typeof usersTable.$inferSelect;
  session?: typeof sessionsTable.$inferSelect;
}

export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const token = authHeader.slice(7);
  const now = new Date();

  const sessions = await db
    .select({ session: sessionsTable, user: usersTable })
    .from(sessionsTable)
    .innerJoin(usersTable, eq(sessionsTable.userId, usersTable.id))
    .where(
      and(
        eq(sessionsTable.token, token),
        gt(sessionsTable.expiresAt, now),
      ),
    )
    .limit(1);

  if (!sessions.length) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  // Platform-level disablement (WS-2, Owner Decision #20): re-checked live
  // on every request, from the same query, at zero extra query cost — never
  // cached, never inferred from token claims. A user disabled mid-session
  // is rejected on their very next request, not merely once their token
  // eventually expires (disableUser() also proactively deletes every
  // session for the user, so this is defense in depth, not the only
  // enforcement). Deliberately the same generic 401 the auth model already
  // returns for an invalid/expired session — this boundary does not
  // distinguish "wrong token" from "disabled account" in its response.
  if (sessions[0].user.disabledAt != null) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  req.userId = sessions[0].user.id;
  req.user = sessions[0].user;
  req.session = sessions[0].session;
  next();
}
