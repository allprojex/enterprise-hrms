/**
 * Tenant identity hardening — Phase 8 (change blast-radius classification)
 * and Phase 9 test 9 ("platform-wide changes are explicitly classified").
 *
 * The property under test: every operational action kind the platform
 * records has ONE declared blast radius, and the classifier refuses any
 * target shape that would misstate it — in particular a tenant-scoped action
 * with no explicit tenant (which is how a "fix for one organization" would
 * silently become a fleet-wide one) and an installation-wide action pinned
 * to a single organization (the "most dangerous lie").
 */
import { describe, it, expect } from "vitest";
import {
  BLAST_RADII,
  OPERATION_BLAST_RADIUS,
  BlastRadiusViolation,
  classifyOperation,
  auditScopeMetadata,
  blastRadiusOf,
  isOperationKind,
  type OperationKind,
} from "../lib/platformOperations/blastRadius";

const KINDS = Object.keys(OPERATION_BLAST_RADIUS) as OperationKind[];

describe("registry completeness", () => {
  it("every registered operation kind has exactly one of the three radii", () => {
    expect(KINDS.length).toBeGreaterThan(0);
    for (const kind of KINDS) {
      expect(BLAST_RADII).toContain(blastRadiusOf(kind));
    }
  });

  it("all three radii are represented so no class of change is left unclassified", () => {
    const present = new Set(KINDS.map(blastRadiusOf));
    expect([...present].sort()).toEqual([...BLAST_RADII].sort());
  });

  it("the operational actions shipped by earlier workstreams are all classified", () => {
    for (const kind of [
      "organization.suspend",
      "organization.reactivate",
      "organization.update",
      "organization.feature_flag.set",
      "break_glass.grant",
      "installation.deployment.record",
      "installation.backup.request",
      "installation.backup.run",
      "installation.backup.policy",
      "installation.restore",
      "installation.register",
      "platform.operation_grant",
    ]) {
      expect(isOperationKind(kind)).toBe(true);
    }
    expect(isOperationKind("something.nobody.declared")).toBe(false);
  });
});

describe("tenant-scoped operations", () => {
  it("require an explicit target organization", () => {
    expect(() => classifyOperation("organization.suspend", {})).toThrow(BlastRadiusViolation);
    expect(() => classifyOperation("organization.suspend", { organizationId: null })).toThrow(/explicit target organization/);
  });

  it("are never inferred from a non-id value (0, negative, NaN, float)", () => {
    for (const bad of [0, -1, Number.NaN, 1.5]) {
      expect(() => classifyOperation("organization.feature_flag.set", { organizationId: bad })).toThrow(BlastRadiusViolation);
    }
  });

  it("classify cleanly with an explicit organization, keeping the target in the audit metadata", () => {
    const scope = classifyOperation("break_glass.grant", { organizationId: 42, installationId: 7 });
    expect(scope).toEqual({
      operation: "break_glass.grant",
      blastRadius: "tenant_scoped",
      targetOrganizationId: 42,
      targetInstallationId: 7,
    });
    expect(auditScopeMetadata(scope)).toMatchObject({ blastRadius: "tenant_scoped", targetOrganizationId: 42 });
  });
});

describe("multi-tenant (installation-wide) operations", () => {
  it("require an explicit target installation", () => {
    expect(() => classifyOperation("installation.restore", {})).toThrow(/explicit target installation/);
  });

  it("refuse to be attributed to a single organization", () => {
    expect(() => classifyOperation("installation.restore", { installationId: 3, organizationId: 42 })).toThrow(
      /must not be attributed to one organization/,
    );
  });

  it("classify cleanly against an installation", () => {
    expect(classifyOperation("installation.backup.request", { installationId: 3 })).toEqual({
      operation: "installation.backup.request",
      blastRadius: "multi_tenant",
      targetOrganizationId: null,
      targetInstallationId: 3,
    });
  });
});

describe("platform-wide operations", () => {
  it("are explicitly classified and never carry an organization target", () => {
    expect(classifyOperation("installation.register").blastRadius).toBe("platform_wide");
    expect(() => classifyOperation("platform.operation_grant", { organizationId: 1 })).toThrow(/cannot carry an organization target/);
  });
});
