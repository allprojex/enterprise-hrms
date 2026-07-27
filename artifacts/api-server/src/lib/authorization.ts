import type { usersTable } from "@workspace/db";

type User = typeof usersTable.$inferSelect;

/** super_admin is the only role allowed to cross organization boundaries. */
export function isSuperAdmin(user: User): boolean {
  return user.role === "super_admin";
}
