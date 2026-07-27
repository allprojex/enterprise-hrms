import { Router } from "express";
import { db, rolesTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";

const router = Router();

function formatRole(role: typeof rolesTable.$inferSelect) {
  return {
    id: role.id,
    key: role.key,
    label: role.label,
    description: role.description,
    isSystemRole: role.isSystemRole,
  };
}

// GET /roles
// Reference data (system-wide, not org-scoped) — any authenticated user can
// list roles, needed to render role-assignment UI. Assigning a role to a
// membership is separately gated by membership.manage (see routes/members.ts).
router.get("/roles", requireAuth as any, async (_req, res): Promise<void> => {
  const roles = await db.select().from(rolesTable);
  res.json(roles.map(formatRole));
});

export default router;
