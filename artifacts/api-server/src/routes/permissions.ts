import { Router } from "express";
import { db, permissionsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";

const router = Router();

function formatPermission(permission: typeof permissionsTable.$inferSelect) {
  return {
    id: permission.id,
    key: permission.key,
    resource: permission.resource,
    action: permission.action,
    description: permission.description,
  };
}

// GET /permissions
// Reference data (system-wide, not org-scoped) — any authenticated user can
// list the permission catalog, needed to render role/permission admin UI.
router.get("/permissions", requireAuth as any, async (_req, res): Promise<void> => {
  const permissions = await db.select().from(permissionsTable);
  res.json(permissions.map(formatPermission));
});

export default router;
