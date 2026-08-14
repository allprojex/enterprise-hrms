import { Router } from "express";
import { getPublicTenantContext } from "../lib/organizationDomains";
import type { TenantAwareRequest } from "../middlewares/resolveTenantHost";

const router = Router();

/**
 * GET /tenant-context — public, unauthenticated, no query parameters. Always
 * resolved from the caller's own request hostname (resolveTenantHost, wired
 * globally in app.ts) — never from a client-supplied hostname string. This
 * is deliberate: accepting an arbitrary hostname/slug here would turn this
 * into a tenant directory ("do not expose a public tenant directory"),
 * which the brief explicitly disallows. A caller can only ever learn about
 * the tenant they are actually browsing.
 */
router.get("/tenant-context", async (req: TenantAwareRequest, res): Promise<void> => {
  if (req.resolvedTenantOrganizationId == null) {
    res.json({ resolved: false });
    return;
  }

  const context = await getPublicTenantContext(req.resolvedTenantOrganizationId);
  if (!context) {
    res.json({ resolved: false });
    return;
  }

  res.json({ resolved: true, ...context });
});

export default router;
