import { Router, type Response, type NextFunction } from "express";
import { UpdateOrganizationConfigBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import { requireModuleEnabled } from "../middlewares/requireModuleEnabled";
import {
  isKnownNamespace,
  getNamespaceConfig,
  updateNamespaceConfig,
  InvalidNamespaceConfigError,
  CONFIG_NAMESPACES,
} from "../services/organizationConfig";

const router = Router();

// Namespaces are shared across Foundation config (general, terminology — no
// module) and HR-operations config (attendance — module-gated). Must run
// after requireMembership, before requirePermission, mirroring every other
// module-gated route (W5). An unknown namespace is left to the handler's own
// 404, not gated here.
function requireNamespaceModuleEnabled(req: MembershipRequest, res: Response, next: NextFunction): void {
  const namespace = Array.isArray(req.params.namespace) ? req.params.namespace[0] : req.params.namespace;
  const moduleKey = isKnownNamespace(namespace) ? CONFIG_NAMESPACES[namespace].moduleKey : undefined;
  if (!moduleKey) {
    next();
    return;
  }
  void requireModuleEnabled(moduleKey)(req, res, next);
}

// GET /organizations/:organizationId/config/:namespace
router.get(
  "/organizations/:organizationId/config/:namespace",
  requireAuth as any,
  requireMembership("organizationId"),
  requireNamespaceModuleEnabled,
  requirePermission("organization.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const namespace = Array.isArray(req.params.namespace) ? req.params.namespace[0] : req.params.namespace;
    if (!isKnownNamespace(namespace)) {
      res.status(404).json({ error: `Unknown configuration namespace: ${namespace}` });
      return;
    }

    const config = await getNamespaceConfig(req.membership!.organizationId, namespace);
    res.json(config);
  },
);

// PATCH /organizations/:organizationId/config/:namespace
router.patch(
  "/organizations/:organizationId/config/:namespace",
  requireAuth as any,
  requireMembership("organizationId"),
  requireNamespaceModuleEnabled,
  requirePermission("organization.update"),
  async (req: MembershipRequest, res): Promise<void> => {
    const namespace = Array.isArray(req.params.namespace) ? req.params.namespace[0] : req.params.namespace;
    if (!isKnownNamespace(namespace)) {
      res.status(404).json({ error: `Unknown configuration namespace: ${namespace}` });
      return;
    }

    const parsed = UpdateOrganizationConfigBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    try {
      const config = await updateNamespaceConfig(req.membership!.organizationId, namespace, parsed.data.data);
      res.json(config);
    } catch (err) {
      if (err instanceof InvalidNamespaceConfigError) {
        res.status(400).json({ error: "Invalid configuration for this namespace", issues: err.issues });
        return;
      }
      throw err;
    }
  },
);

export default router;
