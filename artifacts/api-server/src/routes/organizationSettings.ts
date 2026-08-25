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
import { recordAuditEvent } from "../lib/auditLog";

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
      const before = await getNamespaceConfig(req.membership!.organizationId, namespace);
      const config = await updateNamespaceConfig(req.membership!.organizationId, namespace, parsed.data.data);

      // Phase 3H, W114: numbering configuration changes are audited even
      // though this generic config route otherwise is not — existing
      // namespaces (general/terminology/attendance/performance) are left
      // exactly as they were, per the frozen plan's own "audit only what
      // existing infrastructure does not already audit" instruction.
      // WS-3 extends this same targeted exception to audit_retention —
      // changing an organization's retention/legal-hold posture is exactly
      // the kind of security-relevant configuration change this workstream
      // is meant to make traceable; the other, unrelated namespaces are
      // intentionally left out of scope here.
      if (namespace === "numbering") {
        await recordAuditEvent({
          actorApplicationUserId: req.userId!,
          actorMembershipId: req.membership!.id,
          organizationId: req.membership!.organizationId,
          eventType: "numbering_config.updated",
          targetType: "organization_settings",
          targetId: namespace,
          beforeState: before.data,
          afterState: config.data,
        });
      } else if (namespace === "audit_retention") {
        await recordAuditEvent({
          actorApplicationUserId: req.userId!,
          actorMembershipId: req.membership!.id,
          organizationId: req.membership!.organizationId,
          eventType: "audit_retention_config.updated",
          targetType: "organization_settings",
          targetId: namespace,
          beforeState: before.data,
          afterState: config.data,
        });
      }

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
