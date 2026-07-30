/**
 * Idempotent seed for system roles, permissions, and their default
 * role_permissions mapping. Safe to re-run — every insert conflicts
 * harmlessly on the table's unique key. Never touches existing data in
 * other tables. Run manually after applying migrations:
 *   pnpm --filter @workspace/db run seed:roles
 */
import { db, rolesTable, permissionsTable, rolePermissionsTable } from "../index";

const SYSTEM_ROLES = [
  { key: "super_admin", label: "Super Admin", description: "Platform-wide access across all organizations." },
  {
    key: "org_admin",
    label: "Organization Admin",
    description: "Full administrative access within an organization.",
  },
  { key: "hr_manager", label: "HR Manager", description: "Manages HR records within an organization." },
  {
    key: "employee",
    label: "Employee",
    description: "Self-service access to own profile and organization info.",
  },
] as const;

const PERMISSIONS = [
  { key: "organization.read", resource: "organization", action: "read" },
  { key: "organization.update", resource: "organization", action: "update" },
  { key: "membership.read", resource: "membership", action: "read" },
  { key: "membership.manage", resource: "membership", action: "manage" },
  { key: "primary_hr.manage", resource: "primary_hr", action: "manage" },
  { key: "employee.read", resource: "employee", action: "read" },
  { key: "employee.write", resource: "employee", action: "write" },
  { key: "employee.notes.read", resource: "employee", action: "notes.read" },
  { key: "employee.disciplinary.read", resource: "employee", action: "disciplinary.read" },
  { key: "branch.read", resource: "branch", action: "read" },
  { key: "branch.manage", resource: "branch", action: "manage" },
  { key: "department.read", resource: "department", action: "read" },
  { key: "department.manage", resource: "department", action: "manage" },
  { key: "position.read", resource: "position", action: "read" },
  { key: "position.manage", resource: "position", action: "manage" },
  { key: "audit.read", resource: "audit", action: "read" },
  { key: "role.manage", resource: "role", action: "manage" },
  { key: "module.manage", resource: "module", action: "manage" },
  { key: "master_data.manage", resource: "master_data", action: "manage" },
  { key: "leave_type.read", resource: "leave_type", action: "read" },
  { key: "leave_type.manage", resource: "leave_type", action: "manage" },
  { key: "leave_request.read.own", resource: "leave_request", action: "read.own" },
  { key: "leave_request.write.own", resource: "leave_request", action: "write.own" },
  { key: "leave_request.manage", resource: "leave_request", action: "manage" },
  { key: "leave_request.approve", resource: "leave_request", action: "approve" },
  { key: "public_holiday.read", resource: "public_holiday", action: "read" },
  { key: "public_holiday.manage", resource: "public_holiday", action: "manage" },
  // Phase 3A, W43 — Recruitment Foundation. Only the settings permission pair
  // is seeded here (nothing yet enforces it — no recruitment_settings table
  // or route exists until the next workstream); requisition/vacancy/
  // candidate/etc. permission keys belong to their own owning workstreams,
  // per the frozen plan's five-tier model (docs/PHASE_3A_RECRUITMENT_IMPLEMENTATION_PLAN.md §7).
  { key: "recruitment_settings.read", resource: "recruitment_settings", action: "read" },
  { key: "recruitment_settings.manage", resource: "recruitment_settings", action: "manage" },
  // Phase 3A, W45 — Job Requisition Foundation. Coarse read gate seeded to
  // every role (mirrors leave_request.approve's precedent: any employee
  // could be a requisition's assigned hiring manager or recruiter via
  // hiringManagerEmployeeId/recruiterEmployeeId) — which records a caller
  // can actually see is narrowed per-record in the service layer
  // (own/assigned/hiring-manager/department/branch/organization-wide, per
  // the frozen plan's five-tier model). create/update/cancel are
  // administrative actions, org_admin/hr_manager only, same rollout as
  // leave_type.manage.
  { key: "requisition.read", resource: "requisition", action: "read" },
  { key: "requisition.create", resource: "requisition", action: "create" },
  { key: "requisition.update", resource: "requisition", action: "update" },
  { key: "requisition.cancel", resource: "requisition", action: "cancel" },
  // Phase 3A, W47 in the frozen plan's own numbering (this session's W46) —
  // Requisition Approval Workflow. Org-wide only, same rollout as
  // requisition.update: this workstream's narrowed approval model has no
  // delegated-approver (assigned recruiter/hiring manager) tier, since no
  // delegation configuration exists yet anywhere in Recruitment — see
  // requisitionApprovals.ts for the documented simplification.
  { key: "requisition.approve", resource: "requisition", action: "approve" },
  // Phase 3A, W48 in the frozen plan's own numbering (this session's W47) —
  // Vacancy Management Foundation. `vacancy.read` is seeded to every role,
  // same reasoning as requisition.read (any employee could be the assigned
  // recruiter/hiring manager on the linked requisition — the frozen plan's
  // §7 permission matrix has no "own" tier for vacancies, only assigned/
  // org-wide, resolved per-record in the service layer). `.manage`
  // (create/update), `.publish` (publish/pause), and `.close` (close/
  // archive) are administrative, org_admin/hr_manager only, same rollout as
  // requisition.create/.update/.cancel.
  { key: "vacancy.read", resource: "vacancy", action: "read" },
  { key: "vacancy.manage", resource: "vacancy", action: "manage" },
  { key: "vacancy.publish", resource: "vacancy", action: "publish" },
  { key: "vacancy.close", resource: "vacancy", action: "close" },
  // Phase 3A, W51 — Application Pipeline & Stage Movement. `application.read`
  // is seeded to every role, same reasoning as vacancy.read/requisition.read
  // (any employee could be the assigned recruiter/hiring manager on the
  // application's linked requisition — visibility itself is narrowed
  // per-record in the service layer, assigned/organization-wide only, no
  // "own" tier since no candidate-session concept exists, W50 deferred).
  // `application.pipeline.move` gates every stage-movement action
  // (move-stage/reject/withdraw/reopen) — administrative, org_admin/
  // hr_manager only, same rollout as vacancy.publish/vacancy.close (the
  // permission matrix's "Assigned" column is realized as a visibility tier
  // only, not a broader role grant, mirroring every prior Recruitment
  // workstream's precedent since no dedicated "recruiter"/"hiring manager"
  // role exists in this platform's role model).
  { key: "application.read", resource: "application", action: "read" },
  { key: "application.pipeline.move", resource: "application", action: "pipeline.move" },
] as const;

const ROLE_PERMISSIONS: Record<string, readonly string[]> = {
  super_admin: PERMISSIONS.map((p) => p.key),
  org_admin: [
    "organization.read",
    "organization.update",
    "membership.read",
    "membership.manage",
    "primary_hr.manage",
    "employee.read",
    "employee.write",
    "employee.notes.read",
    "employee.disciplinary.read",
    "branch.read",
    "branch.manage",
    "department.read",
    "department.manage",
    "position.read",
    "position.manage",
    "audit.read",
    "role.manage",
    "module.manage",
    "master_data.manage",
    "leave_type.read",
    "leave_type.manage",
    "leave_request.read.own",
    "leave_request.write.own",
    "leave_request.manage",
    "leave_request.approve",
    "public_holiday.read",
    "public_holiday.manage",
    "recruitment_settings.read",
    "recruitment_settings.manage",
    "requisition.read",
    "requisition.create",
    "requisition.update",
    "requisition.cancel",
    "requisition.approve",
    "vacancy.read",
    "vacancy.manage",
    "vacancy.publish",
    "vacancy.close",
    "application.read",
    "application.pipeline.move",
  ],
  hr_manager: [
    "organization.read",
    "membership.read",
    "employee.read",
    "employee.write",
    "employee.notes.read",
    "employee.disciplinary.read",
    "branch.read",
    "branch.manage",
    "department.read",
    "department.manage",
    "position.read",
    "position.manage",
    "leave_type.read",
    "leave_type.manage",
    "leave_request.read.own",
    "leave_request.write.own",
    "leave_request.manage",
    "leave_request.approve",
    "public_holiday.read",
    "public_holiday.manage",
    "recruitment_settings.read",
    "recruitment_settings.manage",
    "requisition.read",
    "requisition.create",
    "requisition.update",
    "requisition.cancel",
    "requisition.approve",
    "vacancy.read",
    "vacancy.manage",
    "vacancy.publish",
    "vacancy.close",
    "application.read",
    "application.pipeline.move",
  ],
  employee: [
    "organization.read",
    "employee.read",
    "branch.read",
    "department.read",
    "position.read",
    "leave_type.read",
    "public_holiday.read",
    "leave_request.read.own",
    "leave_request.write.own",
    "leave_request.approve",
    "requisition.read",
    "vacancy.read",
    "application.read",
  ],
};

async function main() {
  await db.insert(rolesTable).values([...SYSTEM_ROLES]).onConflictDoNothing({ target: rolesTable.key });
  await db
    .insert(permissionsTable)
    .values([...PERMISSIONS])
    .onConflictDoNothing({ target: permissionsTable.key });

  const roles = await db.select().from(rolesTable);
  const permissions = await db.select().from(permissionsTable);
  const roleByKey = new Map(roles.map((r) => [r.key, r]));
  const permissionByKey = new Map(permissions.map((p) => [p.key, p]));

  for (const [roleKey, permissionKeys] of Object.entries(ROLE_PERMISSIONS)) {
    const role = roleByKey.get(roleKey);
    if (!role) continue;

    for (const permissionKey of permissionKeys) {
      const permission = permissionByKey.get(permissionKey);
      if (!permission) continue;

      await db
        .insert(rolePermissionsTable)
        .values({ roleId: role.id, permissionId: permission.id })
        .onConflictDoNothing({
          target: [rolePermissionsTable.roleId, rolePermissionsTable.permissionId],
        });
    }
  }

  console.log("Seeded roles, permissions, and role_permissions.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
