/**
 * WS-3 (Audit & Sensitive-Data Security Hardening, Owner Decision #17) —
 * resolves which audit categories a membership may read. The pre-existing
 * broad "audit.read" permission continues to mean "every category" (its
 * current holders — org_admin, and the org-scoped "super_admin" role
 * template — lose no access); the six new "audit.read.<category>"
 * permissions (lib/auditCategories.ts's AUDIT_CATEGORIES) grant one
 * category each. A membership's allowed set is the union of both.
 */
import { getEffectivePermissions } from "./permissions";
import { AUDIT_CATEGORIES, type AuditCategory } from "./auditCategories";

export type AllowedAuditCategories = "all" | AuditCategory[];

export async function resolveAllowedAuditCategories(membershipId: number): Promise<AllowedAuditCategories> {
  const permissions = await getEffectivePermissions(membershipId);

  if (permissions.has("audit.read")) {
    return "all";
  }

  const allowed = AUDIT_CATEGORIES.filter((category) => permissions.has(`audit.read.${category}`));
  return allowed;
}
