import { Router } from "express";
import { db, modulesTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";

const router = Router();

function formatModule(module: typeof modulesTable.$inferSelect) {
  return {
    id: module.id,
    key: module.key,
    name: module.name,
    description: module.description,
    category: module.category,
    version: module.version,
    status: module.status,
    defaultEnabled: module.defaultEnabled,
    requiredModuleKeys: module.requiredModuleKeys,
    optionalModuleKeys: module.optionalModuleKeys,
  };
}

// GET /modules
// The platform-wide module catalog (reference data, not org-scoped) — any
// authenticated user can list it, matching the roles/permissions catalog
// pattern. This is the registry only; whether a given organization has a
// module turned on is a separate concern (organization_modules, W4), not
// modeled here yet.
router.get("/modules", requireAuth as any, async (_req, res): Promise<void> => {
  const modules = await db.select().from(modulesTable);
  res.json(modules.map(formatModule));
});

export default router;
