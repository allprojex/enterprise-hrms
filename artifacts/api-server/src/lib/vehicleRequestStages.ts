/**
 * VR-02A — configuration of the Vehicle Request approval chain.
 *
 * An organization decides its own chain: one stage or several, in a strict
 * ascending order, each naming one of three server-defined resolvers. This is
 * configuration ONLY — nothing here decides a request, and VR-02A cannot
 * create one.
 *
 * WHY A SEPARATE, VEHICLE-OWNED STAGE TABLE. WS-13's `request_approval_stages`
 * is namespaced to WS-13 by explicit policy (§29.8: "DELIBERATELY WS-13'S OWN,
 * NOT A SHARED PRIMITIVE") and foreign-keyed to `data_change_requests` by
 * structure, so it can neither be borrowed nor extended. Duplicating WS-9's
 * proven shape is what the repository asks for in exactly this situation.
 *
 * RECONFIGURATION IS NEVER RETROACTIVE. Requests freeze `totalStages` at
 * submission, so editing or removing a stage can never change whether an
 * in-flight request is complete, and an already-recorded decision keeps its own
 * snapshot of the stage that produced it. Nothing here touches a request row.
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  db,
  vehicleRequestApprovalStagesTable,
  organizationMembershipsTable,
  membershipRolesTable,
  rolesTable,
  rolePermissionsTable,
  permissionsTable,
  usersTable,
  type VehicleRequestApprovalStage,
} from "@workspace/db";
import { activeAndUnexpired } from "./membership";
import { roleOwnedByMembershipOrganization } from "./permissions";
import { recordAuditEvent } from "./auditLog";
import { isUniqueViolation } from "./dbErrors";
import {
  readPermissionHolderConfig,
  readSpecificMembershipConfig,
  VEHICLE_REQUEST_APPROVE_PERMISSION,
} from "./vehicleRequestAuthority";

export const VEHICLE_REQUEST_PURPOSE = "vehicle_request" as const;

export class VehicleRequestStageNotFoundError extends Error {
  constructor() {
    super("Approval stage not found");
    this.name = "VehicleRequestStageNotFoundError";
  }
}

export class InvalidVehicleRequestStageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidVehicleRequestStageError";
  }
}

export class DuplicateVehicleRequestStageOrderError extends Error {
  constructor() {
    super("Another stage already occupies that position in the chain");
    this.name = "DuplicateVehicleRequestStageOrderError";
  }
}

type ResolverType = VehicleRequestApprovalStage["resolverType"];

function normalizeName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, " ");
  if (!name) throw new InvalidVehicleRequestStageError("name is required");
  if (name.length > 120) throw new InvalidVehicleRequestStageError("name must be 120 characters or fewer");
  return name;
}

/**
 * A stage that authorizes nobody is worse than no stage at all — it strands
 * every request that reaches it — so a malformed resolver config is refused at
 * configuration time rather than discovered at decision time.
 *
 * The returned value is what gets stored: narrowed to exactly the fields the
 * resolver reads, so no unvalidated extra keys ride along in the jsonb.
 */
export async function validateResolverConfig(
  organizationId: number,
  resolverType: ResolverType,
  resolverConfig: unknown,
): Promise<unknown> {
  switch (resolverType) {
    case "department_head": {
      // The request supplies the department, so this resolver takes no input.
      // An empty object and null are both accepted; anything carrying data is
      // refused rather than silently ignored.
      if (resolverConfig == null) return {};
      if (typeof resolverConfig !== "object" || Array.isArray(resolverConfig)) {
        throw new InvalidVehicleRequestStageError("department_head takes no resolver configuration");
      }
      if (Object.keys(resolverConfig as Record<string, unknown>).length > 0) {
        throw new InvalidVehicleRequestStageError("department_head takes no resolver configuration");
      }
      return {};
    }
    case "permission_holder": {
      const config = readPermissionHolderConfig(resolverConfig);
      if (!config) throw new InvalidVehicleRequestStageError("permission_holder requires a permissionKey");
      // Checked against the live permission registry: a typo would otherwise
      // configure a stage that authorizes nobody, forever, and would only be
      // discovered when a request stalled at it.
      const [known] = await db
        .select({ key: permissionsTable.key })
        .from(permissionsTable)
        .where(eq(permissionsTable.key, config.permissionKey))
        .limit(1);
      if (!known) {
        throw new InvalidVehicleRequestStageError(`permissionKey "${config.permissionKey}" is not a known permission`);
      }
      return { permissionKey: config.permissionKey };
    }
    case "specific_membership": {
      const config = readSpecificMembershipConfig(resolverConfig);
      if (!config) throw new InvalidVehicleRequestStageError("specific_membership requires a membershipId");
      const [membership] = await db
        .select({ id: organizationMembershipsTable.id })
        .from(organizationMembershipsTable)
        .where(
          and(
            eq(organizationMembershipsTable.id, config.membershipId),
            eq(organizationMembershipsTable.organizationId, organizationId),
          ),
        )
        .limit(1);
      // Naming someone from another organization would be a cross-tenant
      // authority grant, so it is refused here, not left to the resolver.
      if (!membership) throw new InvalidVehicleRequestStageError("membershipId does not belong to this organization");
      return { membershipId: config.membershipId };
    }
    default:
      throw new InvalidVehicleRequestStageError("Unknown resolver type");
  }
}

/**
 * The minimum identity the configuration UI needs to name a person, and
 * nothing else. Deliberately NOT MemberSummary: no email, no role list, no
 * Primary HR flag, no user id, no membership metadata. A configuration
 * administrator is choosing an approver, not reading the membership directory.
 */
export interface VehicleRequestApprovalCandidate {
  membershipId: number;
  firstName: string;
  lastName: string;
}

/**
 * Who may legitimately be named by a `specific_membership` stage.
 *
 * A named person who does not hold `vehicle_request.approve` can never resolve
 * — `resolveApprovalAuthority` checks the permission first and returns null
 * without it — so a stage naming them would strand every request that reached
 * it. Listing the whole organization would therefore offer choices that are
 * guaranteed to be wrong, which is why this returns candidates rather than
 * members.
 *
 * THIS GRANTS NOTHING. It reports who already holds the permission; it never
 * confers it, and approval execution re-checks the permission independently at
 * decision time. Removing someone from this list cannot revoke authority and
 * appearing on it cannot create any.
 *
 * Active membership uses the repository's authoritative predicate,
 * `activeAndUnexpired()`, rather than a second reading of "active" that could
 * drift from it. Permission possession is resolved through
 * membership_roles -> role_permissions -> permissions BY KEY — never by role
 * NAME — so a permission granted through an organization-defined custom role
 * counts exactly as much as one from a system template.
 */
export async function listApprovalCandidates(organizationId: number): Promise<VehicleRequestApprovalCandidate[]> {
  const rows = await db
    .selectDistinct({
      membershipId: organizationMembershipsTable.id,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
    })
    .from(organizationMembershipsTable)
    .innerJoin(usersTable, eq(organizationMembershipsTable.applicationUserId, usersTable.id))
    .innerJoin(membershipRolesTable, eq(membershipRolesTable.membershipId, organizationMembershipsTable.id))
    .innerJoin(rolesTable, eq(rolesTable.id, membershipRolesTable.roleId))
    .innerJoin(rolePermissionsTable, eq(rolePermissionsTable.roleId, membershipRolesTable.roleId))
    .innerJoin(permissionsTable, eq(rolePermissionsTable.permissionId, permissionsTable.id))
    .where(
      and(
        // Tenant scope first: the organization comes from the caller's own
        // resolved membership, never from anything a client supplied.
        eq(organizationMembershipsTable.organizationId, organizationId),
        activeAndUnexpired(),
        // A role another organization owns never makes a member a candidate.
        roleOwnedByMembershipOrganization(),
        eq(permissionsTable.key, VEHICLE_REQUEST_APPROVE_PERMISSION),
      ),
    );

  return rows.sort((a, b) =>
    `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`),
  );
}

export async function listStages(organizationId: number): Promise<VehicleRequestApprovalStage[]> {
  return db
    .select()
    .from(vehicleRequestApprovalStagesTable)
    .where(
      and(
        eq(vehicleRequestApprovalStagesTable.organizationId, organizationId),
        eq(vehicleRequestApprovalStagesTable.purpose, VEHICLE_REQUEST_PURPOSE),
      ),
    )
    .orderBy(asc(vehicleRequestApprovalStagesTable.stageOrder));
}

export async function getStageById(organizationId: number, stageId: number): Promise<VehicleRequestApprovalStage | null> {
  const [stage] = await db
    .select()
    .from(vehicleRequestApprovalStagesTable)
    .where(and(eq(vehicleRequestApprovalStagesTable.id, stageId), eq(vehicleRequestApprovalStagesTable.organizationId, organizationId)))
    .limit(1);
  return stage ?? null;
}

/** How many stages this organization has configured — what VR-02B will freeze onto a request. */
export async function countStages(organizationId: number): Promise<number> {
  return (await listStages(organizationId)).length;
}

export interface CreateStageParams {
  organizationId: number;
  stageOrder: number;
  name: string;
  resolverType: ResolverType;
  resolverConfig?: unknown;
  actorApplicationUserId: number;
  actorMembershipId: number;
}

export async function createStage(params: CreateStageParams): Promise<VehicleRequestApprovalStage> {
  if (!Number.isInteger(params.stageOrder) || params.stageOrder < 1) {
    throw new InvalidVehicleRequestStageError("stageOrder must be a positive integer");
  }
  const name = normalizeName(params.name);
  const resolverConfig = await validateResolverConfig(params.organizationId, params.resolverType, params.resolverConfig);

  let stage: VehicleRequestApprovalStage | undefined;
  try {
    [stage] = await db
      .insert(vehicleRequestApprovalStagesTable)
      .values({
        organizationId: params.organizationId,
        purpose: VEHICLE_REQUEST_PURPOSE,
        stageOrder: params.stageOrder,
        name,
        resolverType: params.resolverType,
        resolverConfig,
        createdByMembershipId: params.actorMembershipId,
        updatedByMembershipId: params.actorMembershipId,
      })
      .returning();
  } catch (err) {
    // The (organization, purpose, order) unique index is the real guarantee, so
    // a concurrent insert of the same position surfaces here rather than
    // through a check-then-insert race.
    if (isUniqueViolation(err)) throw new DuplicateVehicleRequestStageOrderError();
    throw err;
  }

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "vehicle_request.stage_created",
    targetType: "vehicle_request_approval_stage",
    targetId: String(stage!.id),
    afterState: { stageOrder: stage!.stageOrder, name: stage!.name, resolverType: stage!.resolverType },
  });
  return stage!;
}

export interface UpdateStageParams {
  organizationId: number;
  stageId: number;
  stageOrder?: number;
  name?: string;
  resolverType?: ResolverType;
  resolverConfig?: unknown;
  actorApplicationUserId: number;
  actorMembershipId: number;
}

export async function updateStage(params: UpdateStageParams): Promise<VehicleRequestApprovalStage> {
  const existing = await getStageById(params.organizationId, params.stageId);
  if (!existing) throw new VehicleRequestStageNotFoundError();

  const patch: Partial<typeof vehicleRequestApprovalStagesTable.$inferInsert> = {
    updatedByMembershipId: params.actorMembershipId,
  };
  if (params.stageOrder !== undefined) {
    if (!Number.isInteger(params.stageOrder) || params.stageOrder < 1) {
      throw new InvalidVehicleRequestStageError("stageOrder must be a positive integer");
    }
    patch.stageOrder = params.stageOrder;
  }
  if (params.name !== undefined) patch.name = normalizeName(params.name);

  // Changing the resolver type without supplying its config would leave the
  // old type's config behind, authorizing nobody — so the pair is validated
  // together whenever either moves.
  if (params.resolverType !== undefined || params.resolverConfig !== undefined) {
    const resolverType = params.resolverType ?? existing.resolverType;
    const rawConfig = params.resolverConfig !== undefined ? params.resolverConfig : existing.resolverConfig;
    patch.resolverType = resolverType;
    patch.resolverConfig = await validateResolverConfig(params.organizationId, resolverType, rawConfig);
  }

  let updated: VehicleRequestApprovalStage | undefined;
  try {
    [updated] = await db
      .update(vehicleRequestApprovalStagesTable)
      .set(patch)
      .where(
        and(
          eq(vehicleRequestApprovalStagesTable.id, params.stageId),
          eq(vehicleRequestApprovalStagesTable.organizationId, params.organizationId),
        ),
      )
      .returning();
  } catch (err) {
    if (isUniqueViolation(err)) throw new DuplicateVehicleRequestStageOrderError();
    throw err;
  }
  if (!updated) throw new VehicleRequestStageNotFoundError();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "vehicle_request.stage_updated",
    targetType: "vehicle_request_approval_stage",
    targetId: String(updated.id),
    beforeState: { stageOrder: existing.stageOrder, name: existing.name, resolverType: existing.resolverType },
    afterState: { stageOrder: updated.stageOrder, name: updated.name, resolverType: updated.resolverType },
  });
  return updated;
}

export interface DeleteStageParams {
  organizationId: number;
  stageId: number;
  actorApplicationUserId: number;
  actorMembershipId: number;
}

/**
 * Removing a stage changes the chain for FUTURE requests only. In-flight
 * requests carry their own frozen `totalStages` and their decisions carry their
 * own stage snapshots, so nothing already raised is altered — this deletes a
 * configuration row and nothing else.
 */
export async function deleteStage(params: DeleteStageParams): Promise<void> {
  const existing = await getStageById(params.organizationId, params.stageId);
  if (!existing) throw new VehicleRequestStageNotFoundError();

  await db
    .delete(vehicleRequestApprovalStagesTable)
    .where(
      and(
        eq(vehicleRequestApprovalStagesTable.id, params.stageId),
        eq(vehicleRequestApprovalStagesTable.organizationId, params.organizationId),
      ),
    );

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "vehicle_request.stage_deleted",
    targetType: "vehicle_request_approval_stage",
    targetId: String(params.stageId),
    beforeState: { stageOrder: existing.stageOrder, name: existing.name, resolverType: existing.resolverType },
  });
}
