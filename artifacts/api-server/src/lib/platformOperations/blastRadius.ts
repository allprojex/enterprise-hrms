/**
 * Change blast-radius classification (tenant identity hardening, Phase 8).
 *
 * Every operational action the platform records is classified BEFORE it is
 * recorded, so that "what does this touch?" is a property of the operation
 * kind rather than something an operator infers from whichever organization
 * happened to be on screen:
 *
 *   tenant_scoped  — exactly one organization is affected. The organization
 *                    MUST be named explicitly (a positive integer id); it is
 *                    never inferred from a session's active organization or
 *                    a hostname. This is what stops a tenant-scoped action
 *                    from silently becoming platform-wide: without a target
 *                    it is refused, not broadened.
 *   multi_tenant   — every organization on ONE installation is affected
 *                    (a deployment, a backup, a physical restore). The
 *                    installation MUST be named explicitly, and an
 *                    organization must NOT be — attaching one would be the
 *                    "most dangerous lie" lib/db/src/schema/installation-
 *                    restore.ts describes: pretending a whole-database action
 *                    belongs to one customer.
 *   platform_wide  — every installation / every tenant (registering an
 *                    installation, platform authority grants, platform user
 *                    roles). No organization target is accepted.
 *
 * The registry below is the complete list of classified operation kinds. An
 * operation that is not listed cannot be classified and therefore cannot be
 * tagged — TypeScript refuses the key — which is the point: new operational
 * code must declare its radius here, in one place, or it does not compile.
 *
 * The resulting `OperationScope` is written into audit_events.metadata by the
 * call sites (see docs/TENANT_IDENTITY_AND_CUSTOMIZATION.md §8) so the audit
 * trail answers WHO did WHAT to WHICH TENANT (or installation) with WHAT
 * blast radius. No schema change was needed: metadata is the documented jsonb
 * slot for exactly this kind of structured context.
 */

export const BLAST_RADII = ["tenant_scoped", "multi_tenant", "platform_wide"] as const;
export type BlastRadius = (typeof BLAST_RADII)[number];

export const OPERATION_BLAST_RADIUS = {
  // --- tenant-scoped: one organization, explicitly named ---
  "organization.suspend": "tenant_scoped",
  "organization.reactivate": "tenant_scoped",
  "organization.update": "tenant_scoped",
  "organization.module.toggle": "tenant_scoped",
  "organization.config.update": "tenant_scoped",
  "organization.feature_flag.set": "tenant_scoped",
  "organization.domain.change": "tenant_scoped",
  "organization.installation.link": "tenant_scoped",
  "break_glass.grant": "tenant_scoped",
  // --- multi-tenant: one installation, every organization on it ---
  "installation.deployment.record": "multi_tenant",
  "installation.backup.policy": "multi_tenant",
  "installation.backup.request": "multi_tenant",
  "installation.backup.run": "multi_tenant",
  "installation.restore": "multi_tenant",
  // --- platform-wide ---
  "installation.register": "platform_wide",
  "platform.operation_grant": "platform_wide",
  "platform.user.role": "platform_wide",
} as const satisfies Record<string, BlastRadius>;

export type OperationKind = keyof typeof OPERATION_BLAST_RADIUS;

export interface OperationTarget {
  organizationId?: number | null;
  installationId?: number | null;
}

export interface OperationScope {
  operation: OperationKind;
  blastRadius: BlastRadius;
  targetOrganizationId: number | null;
  targetInstallationId: number | null;
}

export class BlastRadiusViolation extends Error {
  constructor(
    public readonly operation: OperationKind,
    public readonly blastRadius: BlastRadius,
    detail: string,
  ) {
    super(`${operation} is ${blastRadius}: ${detail}`);
    this.name = "BlastRadiusViolation";
  }
}

function isId(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

export function isOperationKind(value: string): value is OperationKind {
  return Object.prototype.hasOwnProperty.call(OPERATION_BLAST_RADIUS, value);
}

export function blastRadiusOf(operation: OperationKind): BlastRadius {
  return OPERATION_BLAST_RADIUS[operation];
}

/**
 * Classifies an operation against its declared target and refuses any
 * combination that would misstate the blast radius. Call it before the
 * action is performed, and record the result alongside the audit event.
 */
export function classifyOperation(operation: OperationKind, target: OperationTarget = {}): OperationScope {
  const blastRadius = blastRadiusOf(operation);
  const organizationId = target.organizationId ?? null;
  const installationId = target.installationId ?? null;

  if (organizationId !== null && !isId(organizationId)) {
    throw new BlastRadiusViolation(operation, blastRadius, `organization target ${String(organizationId)} is not a valid id`);
  }
  if (installationId !== null && !isId(installationId)) {
    throw new BlastRadiusViolation(operation, blastRadius, `installation target ${String(installationId)} is not a valid id`);
  }

  switch (blastRadius) {
    case "tenant_scoped":
      if (organizationId === null) {
        throw new BlastRadiusViolation(
          operation,
          blastRadius,
          "an explicit target organization is required; a tenant-scoped action is never inferred from the current session or hostname",
        );
      }
      break;
    case "multi_tenant":
      if (installationId === null) {
        throw new BlastRadiusViolation(operation, blastRadius, "an explicit target installation is required");
      }
      if (organizationId !== null) {
        throw new BlastRadiusViolation(
          operation,
          blastRadius,
          "an installation-wide action affects every organization on the installation and must not be attributed to one organization",
        );
      }
      break;
    case "platform_wide":
      if (organizationId !== null) {
        throw new BlastRadiusViolation(operation, blastRadius, "a platform-wide action cannot carry an organization target");
      }
      break;
  }

  return { operation, blastRadius, targetOrganizationId: organizationId, targetInstallationId: installationId };
}

/** The shape written into audit_events.metadata for a classified operation. */
export function auditScopeMetadata(scope: OperationScope): {
  operation: OperationKind;
  blastRadius: BlastRadius;
  targetOrganizationId: number | null;
  targetInstallationId: number | null;
} {
  return {
    operation: scope.operation,
    blastRadius: scope.blastRadius,
    targetOrganizationId: scope.targetOrganizationId,
    targetInstallationId: scope.targetInstallationId,
  };
}
