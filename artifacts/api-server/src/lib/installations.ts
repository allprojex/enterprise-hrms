/**
 * WS-4 (Installation Registry, Owner Decision #29) — the smallest durable
 * registry that can identify a deployed HRMS runtime/environment. Deliberately
 * NOT a fleet-management Control Plane: no health polling, no remote control,
 * no backup/update orchestration — those are explicitly deferred to later
 * workstreams that can attach to this identity foundation without redesigning
 * it (see docs/INSTALLATION_AND_BREAK_GLASS.md).
 *
 * CUSTOMER is not necessarily ORGANIZATION is not necessarily INSTALLATION is
 * not necessarily ENVIRONMENT: one installation may host one or many
 * organizations (installation_organizations is a join table, not a single FK
 * on installations), and one organization may be served by more than one
 * installation over time (dev/staging/production).
 */
import { randomUUID } from "node:crypto";
import { eq, and, isNull } from "drizzle-orm";
import { db, installationsTable, installationOrganizationsTable, organizationsTable } from "@workspace/db";
import { isUniqueViolation } from "./dbErrors";
import { recordAuditEvent } from "./auditLog";

export type Installation = typeof installationsTable.$inferSelect;
export type InstallationOrganization = typeof installationOrganizationsTable.$inferSelect;

export class InstallationNotFoundError extends Error {}
export class DuplicateInstallationKeyError extends Error {}
export class OrganizationNotFoundError extends Error {}
export class OrganizationAlreadyLinkedError extends Error {}
export class OrganizationNotLinkedError extends Error {}

export interface CreateInstallationInput {
  installationKey?: string | null;
  name: string;
  environmentType: "development" | "staging" | "demo" | "production";
  hostingModel: "shared" | "dedicated_owner_managed" | "dedicated_customer_managed" | "other";
  hostingProvider?: string | null;
  primaryDomain?: string | null;
  applicationVersion?: string | null;
  gitCommit?: string | null;
  migrationVersion?: string | null;
  deployedAt?: Date | null;
  healthUrl?: string | null;
  extensionProfile?: string | null;
}

/**
 * Creates a registry record. `installationKey` is the stable identifier a
 * deployed application's own environment configuration will carry (§17) — if
 * the caller doesn't supply one (e.g. registering a not-yet-deployed
 * environment ahead of time), a random one is generated so it still exists
 * to configure into that deployment later. Never regenerated afterward.
 */
export async function createInstallation(input: CreateInstallationInput, actorUserId: number): Promise<Installation> {
  const installationKey = input.installationKey?.trim() || randomUUID();

  try {
    const [installation] = await db
      .insert(installationsTable)
      .values({
        installationKey,
        name: input.name,
        environmentType: input.environmentType,
        hostingModel: input.hostingModel,
        hostingProvider: input.hostingProvider ?? null,
        primaryDomain: input.primaryDomain ?? null,
        applicationVersion: input.applicationVersion ?? null,
        gitCommit: input.gitCommit ?? null,
        migrationVersion: input.migrationVersion ?? null,
        deployedAt: input.deployedAt ?? null,
        healthUrl: input.healthUrl ?? null,
        extensionProfile: input.extensionProfile ?? null,
      })
      .returning();

    await recordAuditEvent({
      actorApplicationUserId: actorUserId,
      eventType: "installation.created",
      targetType: "installation",
      targetId: String(installation.id),
      afterState: installation,
      outcome: "success",
    });

    return installation;
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new DuplicateInstallationKeyError(`installationKey "${installationKey}" is already registered`);
    }
    throw err;
  }
}

export async function listInstallations(): Promise<Installation[]> {
  return db.select().from(installationsTable);
}

export async function getInstallationById(id: number): Promise<Installation | null> {
  const rows = await db.select().from(installationsTable).where(eq(installationsTable.id, id)).limit(1);
  return rows[0] ?? null;
}

export interface UpdateInstallationInput {
  name?: string;
  environmentType?: "development" | "staging" | "demo" | "production";
  hostingModel?: "shared" | "dedicated_owner_managed" | "dedicated_customer_managed" | "other";
  hostingProvider?: string | null;
  primaryDomain?: string | null;
  applicationVersion?: string | null;
  gitCommit?: string | null;
  migrationVersion?: string | null;
  deployedAt?: Date | null;
  healthUrl?: string | null;
  extensionProfile?: string | null;
  status?: "active" | "inactive" | "decommissioned";
}

/**
 * Updates safe registry metadata. `installationKey` is never accepted here —
 * it is immutable after creation (§17: "Do not generate a new installation ID
 * on every restart," and by extension never on an edit either — a changed key
 * would sever a live deployment's own self-identity link).
 */
export async function updateInstallation(
  id: number,
  patch: UpdateInstallationInput,
  actorUserId: number,
): Promise<Installation> {
  const before = await getInstallationById(id);
  if (!before) throw new InstallationNotFoundError(`No installation with id ${id}`);

  const [updated] = await db
    .update(installationsTable)
    .set(patch)
    .where(eq(installationsTable.id, id))
    .returning();

  const statusChanged = patch.status !== undefined && patch.status !== before.status;
  await recordAuditEvent({
    actorApplicationUserId: actorUserId,
    eventType: statusChanged ? "installation.status_changed" : "installation.updated",
    targetType: "installation",
    targetId: String(id),
    beforeState: before,
    afterState: updated,
    outcome: "success",
  });

  return updated!;
}

export async function listOrganizationsForInstallation(installationId: number): Promise<InstallationOrganization[]> {
  return db
    .select()
    .from(installationOrganizationsTable)
    .where(and(eq(installationOrganizationsTable.installationId, installationId), isNull(installationOrganizationsTable.unlinkedAt)));
}

export async function linkOrganization(
  installationId: number,
  organizationId: number,
  actorUserId: number,
): Promise<InstallationOrganization> {
  const installation = await getInstallationById(installationId);
  if (!installation) throw new InstallationNotFoundError(`No installation with id ${installationId}`);

  const [org] = await db.select().from(organizationsTable).where(eq(organizationsTable.id, organizationId)).limit(1);
  if (!org) throw new OrganizationNotFoundError(`No organization with id ${organizationId}`);

  try {
    const [link] = await db
      .insert(installationOrganizationsTable)
      .values({ installationId, organizationId })
      .returning();

    await recordAuditEvent({
      actorApplicationUserId: actorUserId,
      organizationId,
      eventType: "installation.organization_linked",
      targetType: "installation",
      targetId: String(installationId),
      metadata: { organizationId },
      outcome: "success",
    });

    return link;
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new OrganizationAlreadyLinkedError(`Organization ${organizationId} is already linked to installation ${installationId}`);
    }
    throw err;
  }
}

export async function unlinkOrganization(
  installationId: number,
  organizationId: number,
  actorUserId: number,
): Promise<InstallationOrganization> {
  const [existing] = await db
    .select()
    .from(installationOrganizationsTable)
    .where(
      and(
        eq(installationOrganizationsTable.installationId, installationId),
        eq(installationOrganizationsTable.organizationId, organizationId),
        isNull(installationOrganizationsTable.unlinkedAt),
      ),
    )
    .limit(1);
  if (!existing) {
    throw new OrganizationNotLinkedError(`Organization ${organizationId} is not currently linked to installation ${installationId}`);
  }

  const [updated] = await db
    .update(installationOrganizationsTable)
    .set({ unlinkedAt: new Date() })
    .where(eq(installationOrganizationsTable.id, existing.id))
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: actorUserId,
    organizationId,
    eventType: "installation.organization_unlinked",
    targetType: "installation",
    targetId: String(installationId),
    metadata: { organizationId },
    outcome: "success",
  });

  return updated!;
}
