import { Router } from "express";
import { CreateMasterDataItemBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import {
  listMasterDataDomains,
  listMasterDataItems,
  createMasterDataItem,
  MasterDataDomainNotFoundError,
  MasterDataDomainNotWritableError,
  MasterDataItemAlreadyExistsError,
} from "../lib/masterData";

const router = Router();

// GET /master-data/domains
// The domain registry (reference data, not org-scoped) — any authenticated
// user can list it, matching the modules/roles/permissions catalog pattern.
router.get("/master-data/domains", requireAuth as any, async (_req, res): Promise<void> => {
  const domains = await listMasterDataDomains();
  res.json(domains.map((d) => ({ key: d.key, label: d.label, classification: d.classification })));
});

// GET /organizations/:organizationId/master-data/:domain
router.get(
  "/organizations/:organizationId/master-data/:domain",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("organization.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const domain = Array.isArray(req.params.domain) ? req.params.domain[0] : req.params.domain;
    try {
      const items = await listMasterDataItems(req.membership!.organizationId, domain);
      res.json(items);
    } catch (err) {
      if (err instanceof MasterDataDomainNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// POST /organizations/:organizationId/master-data/:domain
router.post(
  "/organizations/:organizationId/master-data/:domain",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("master_data.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const domain = Array.isArray(req.params.domain) ? req.params.domain[0] : req.params.domain;

    const parsed = CreateMasterDataItemBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    try {
      const item = await createMasterDataItem({
        organizationId: req.membership!.organizationId,
        domain,
        code: parsed.data.code,
        label: parsed.data.label,
        sortOrder: parsed.data.sortOrder,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.status(201).json(item);
    } catch (err) {
      if (err instanceof MasterDataDomainNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof MasterDataDomainNotWritableError) {
        res.status(400).json({ error: err.message });
        return;
      }
      if (err instanceof MasterDataItemAlreadyExistsError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

export default router;
