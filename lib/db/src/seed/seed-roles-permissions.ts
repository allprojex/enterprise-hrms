/**
 * Idempotent seed for system roles, permissions, and their default
 * role_permissions mapping. Safe to re-run — every insert conflicts
 * harmlessly on the table's unique key. Never touches existing data in
 * other tables. Run manually after applying migrations:
 *   pnpm --filter @workspace/db run seed:roles
 */
import { sql } from "drizzle-orm";
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
  // Phase 3A, W52 — Screening Questions & Scoring. `application.manage`
  // gates score submission specifically — distinct from
  // `application.pipeline.move` (stage transitions) since scoring
  // evaluates an application without ever changing its stage. Already
  // named in the frozen §7 permission matrix (Applications row), just
  // unused until this workstream. Same org_admin/hr_manager-only rollout
  // as every other administrative Recruitment permission.
  { key: "application.manage", resource: "application", action: "manage" },
  // Phase 3A, W53 — Candidate Notes, Tags, and Talent Pools. `candidate.read`
  // and `candidate.notes.read` are both seeded to every role, same reasoning
  // as vacancy.read/application.read (any employee could be the assigned
  // recruiter/hiring manager on a requisition linked to one of the
  // candidate's applications — visibility is narrowed per-record in the
  // service layer, assigned/organization-wide only, no "own" tier, W50
  // deferred; §7's Candidate notes row carries the same assigned/org-wide
  // tiers as Candidates, unlike Talent pools below). `candidate.manage` and
  // `candidate.notes.write` are the administrative counterparts,
  // org_admin/hr_manager only — every Recruitment *write* action stays
  // admin-only regardless of a resource's read-side assigned tier, same
  // rollout as application.pipeline.move/application.manage over
  // application.read. `candidate.manage` also gates tag add/remove per this
  // workstream's own scope decision (avoiding a dedicated tags permission).
  // `talent_pool.read`/`.manage` are org-wide only (§7 — no "assigned" tier
  // at all: a pool isn't reachable through any one requisition's
  // recruiter/hiring-manager), so both are org_admin/hr_manager only, same
  // rollout as leave_type.manage.
  { key: "candidate.read", resource: "candidate", action: "read" },
  { key: "candidate.manage", resource: "candidate", action: "manage" },
  { key: "candidate.notes.read", resource: "candidate", action: "notes.read" },
  { key: "candidate.notes.write", resource: "candidate", action: "notes.write" },
  { key: "talent_pool.read", resource: "talent_pool", action: "read" },
  { key: "talent_pool.manage", resource: "talent_pool", action: "manage" },
  // Phase 3A, W54 — Interviews & Scheduling. §7's Interviews row is a single
  // `interview.read` / `.manage` pair with the assigned tier marked "own
  // scheduled interviews as interviewer" against that one pair — unlike
  // every prior resource's two-key split (e.g. candidate.notes.read/.write),
  // there is no separate write-only key documented here. Kept consistent
  // with this codebase's established rollout rather than treated as a new
  // exception: `interview.read` is seeded to every role (any employee could
  // be an assigned panel interviewer — visibility narrowed per-record in the
  // service layer by panel membership, not the recruiter/hiring-manager
  // chain other resources use). `interview.manage` (schedule/update/
  // reschedule/cancel/panel changes — no dedicated panel-management
  // permission, per §7's own "avoid permission explosion" note) stays
  // org_admin/hr_manager only, the same admin-only rollout every other
  // Recruitment write action uses regardless of a resource's read-side
  // assigned tier (application.pipeline.move/application.manage over
  // application.read; candidate.manage/candidate.notes.write over
  // candidate.read/candidate.notes.read) — an assigned interviewer sees
  // their own scheduled interviews but does not gain a broader write grant,
  // consistent with "no dedicated recruiter/hiring-manager role exists in
  // this platform's role model" (vacancies.ts/applicationPipeline.ts's own
  // documented precedent).
  { key: "interview.read", resource: "interview", action: "read" },
  { key: "interview.manage", resource: "interview", action: "manage" },
  // Phase 3A, W55 — Interview Scorecards. §7's own three keys, used exactly
  // as named: `scorecard.submit` is seeded to every role (any employee could
  // be an assigned panel interviewer — matches interview.read's broad
  // rollout), but visibility is narrowed at the service layer to strictly
  // the caller's own scorecard, freshly re-verified against
  // interview_panel_members on every write. `scorecard.read_all` and
  // `scorecard.finalize` are org_admin/hr_manager only — §7 marks both with
  // no "own"/assigned tier at all (unlike interview.manage, this isn't a
  // rollout judgment call: the matrix literally has no assigned-column
  // checkmark for either). Critically, `scorecard.submit` never implies
  // `scorecard.read_all` even for an org_admin/hr_manager who is also a
  // panel member — §7's own integrity note: "an interviewer must not see
  // colleagues' scores before submitting their own" (bias prevention) — so
  // the service layer's read path checks read_all independently of submit,
  // never treating org-wide submit-rollout as a backdoor into read_all.
  { key: "scorecard.submit", resource: "scorecard", action: "submit" },
  { key: "scorecard.read_all", resource: "scorecard", action: "read_all" },
  { key: "scorecard.finalize", resource: "scorecard", action: "finalize" },
  // Phase 3A, W56 — Reference & Background Checks. No dedicated
  // `reference_check.*` permission exists in §7's matrix at all — reference
  // checks reuse the existing `application.read`/`.manage` pair (assigned
  // recruiter/hiring manager + organization-wide), the same tier as viewing/
  // scoring the application itself (W52's own precedent for `application.manage`
  // gating an assessment action on an application). `background_check.read`/
  // `.manage` ARE their own dedicated pair — §7 marks this row org-wide only,
  // no assigned tier at all (explicitly "the narrowest permission in the
  // matrix" per §23's own verification line), so both are org_admin/
  // hr_manager only, same rollout as talent_pool.read/.manage — holding
  // application.read/.manage (or even candidate.read) never implies
  // background-check access, since result content is explicitly flagged
  // "highly sensitive" in §9, unlike reference checks' "referee PII".
  { key: "background_check.read", resource: "background_check", action: "read" },
  { key: "background_check.manage", resource: "background_check", action: "manage" },
  // Phase 3A, W57 — Offers. `offer.read`/`offer.manage` are the FIRST
  // Recruitment write pair this phase seeded broadly (org_admin, hr_manager,
  // AND employee) — every prior write permission this phase
  // (application.pipeline.move/.manage, candidate.manage,
  // interview.manage, ...) stayed org_admin/hr_manager only regardless of
  // its own read-side assigned tier, because no delegated recruiter/hiring-
  // manager role exists in this codebase's actual three-role model. §7's
  // own matrix marks offer.manage's Assigned column "✔ manage draft" (real
  // write, not just visibility) — and unlike those prior resources, there
  // is genuinely no other mechanism through which an assigned recruiter or
  // hiring manager (a plain "employee" role holder, identified only via
  // the linked requisition's recruiterEmployeeId/hiringManagerEmployeeId)
  // could ever exercise it, so this is a deliberate, textually-supported
  // first exception rather than a broadened rollout policy going forward.
  // The service layer (lib/offers.ts) still independently gates every
  // write on the caller actually being the assigned recruiter/hiring
  // manager (or org-wide) — holding `offer.manage` alone never lets an
  // unrelated employee write an unrelated offer. `offer.approve`/`.issue`/
  // `.withdraw` remain org_admin/hr_manager only, organization-wide only,
  // per §7's own explicit "no assigned tier" marking for those three keys
  // — the same admin-only rollout every other Recruitment approval/
  // finalization action this phase uses (requisition.approve,
  // scorecard.finalize, background_check.manage).
  { key: "offer.read", resource: "offer", action: "read" },
  { key: "offer.manage", resource: "offer", action: "manage" },
  { key: "offer.approve", resource: "offer", action: "approve" },
  { key: "offer.issue", resource: "offer", action: "issue" },
  { key: "offer.withdraw", resource: "offer", action: "withdraw" },
  // Phase 3A, W59 — Employee Conversion. §7's own row: "— / — / ✔ (mirrors
  // employee.write's existing gate)" — no own/assigned tier at all, and
  // deliberately NOT a second employee-creation authority. This gates only
  // the recruitment-side POST .../applications/:id/convert-to-employee
  // trigger; the actual employee INSERT still runs through
  // createEmployee (lib/employees.ts), which the route additionally
  // requires employee.write for — neither permission alone can bypass the
  // other (this workstream's own explicit security requirement). Seeded to
  // the exact same roles as employee.write (org_admin, hr_manager only),
  // never to "employee".
  { key: "candidate.convert_to_employee", resource: "candidate", action: "convert_to_employee" },
  // Phase 3A, W61 — Recruitment Dashboard & Reporting. §7's own single row:
  // "Assigned ✔ (own workload/pipeline scope) / Org-wide ✔" — the same
  // broad-rollout, service-layer-narrowed shape as every other Recruitment
  // *read* permission this phase (requisition.read, vacancy.read,
  // application.read, candidate.read, interview.read, offer.read): seeded
  // to every role since any employee could be the assigned recruiter/
  // hiring manager on a requisition, with org-wide vs. assigned-workload
  // reach resolved per-request in the service layer (lib/recruitmentReporting.ts),
  // never by this permission grant alone — holding it never yields
  // organization-wide analytics for an employee with no requisition
  // assignment. This is the sole permission key W61 introduces; there is no
  // separate dashboard-only key.
  { key: "recruitment.reports.read", resource: "recruitment", action: "reports.read" },
  // Phase 3B, W64 — Attendance Foundation & Module Activation. Four keys
  // total, per docs/PHASE_3B_ATTENDANCE_IMPLEMENTATION_PLAN.md §4's
  // permission matrix. No "team" tier key: reading a direct report's
  // attendance is resolved in the service layer via employees.
  // reportingManagerId, the same own/service-layer-narrowed shape as every
  // comparable permission in this platform (mirrors recruitment.reports.read
  // and leave_request.read.own above) — holding attendance.read.own never
  // by itself grants org-wide reach; that requires attendance.manage.
  { key: "attendance.read.own", resource: "attendance", action: "read.own" },
  { key: "attendance.clock.own", resource: "attendance", action: "clock.own" },
  { key: "attendance.manage", resource: "attendance", action: "manage" },
  { key: "attendance.adjustment.approve", resource: "attendance", action: "adjustment.approve" },
  // Phase 3C, W73 — Performance Foundation. Exactly 6 keys, none of them a
  // ".team" variant, per docs/PHASE_3C_PERFORMANCE_IMPLEMENTATION_PLAN.md
  // §7 — the "manager" tier is a plain employee-role holder whose
  // performance.review.write grant becomes *effective* only on review rows
  // where the service layer's reviewerEmployeeId comparison matches (the
  // same broad-grant-plus-service-layer-narrowing shape attendance.read.own
  // already established), never a separate permission key.
  { key: "performance.read.own", resource: "performance", action: "read.own" },
  { key: "performance.write.own", resource: "performance", action: "write.own" },
  { key: "performance.review.write", resource: "performance", action: "review.write" },
  { key: "performance.manage", resource: "performance", action: "manage" },
  { key: "performance.finalize", resource: "performance", action: "finalize" },
  { key: "performance.reports.read", resource: "performance", action: "reports.read" },
  // Phase 3D, W85 — Learning Foundation. Exactly 5 keys, no ".team" variant,
  // per docs/PHASE_3D_LEARNING_IMPLEMENTATION_PLAN.md §7 — manager-of-record
  // and instructor-of-record scope are both resolved server-side via
  // learning.review.write's relationship dispatch (managerEmployeeIdSnapshot
  // / a session's instructorEmployeeId), never a separate permission key,
  // mirroring performance.review.write's own broad-grant-plus-service-layer-
  // narrowing shape exactly.
  { key: "learning.read.own", resource: "learning", action: "read.own" },
  { key: "learning.write.own", resource: "learning", action: "write.own" },
  { key: "learning.review.write", resource: "learning", action: "review.write" },
  { key: "learning.manage", resource: "learning", action: "manage" },
  { key: "learning.reports.read", resource: "learning", action: "reports.read" },
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
    "application.manage",
    "candidate.read",
    "candidate.manage",
    "candidate.notes.read",
    "candidate.notes.write",
    "talent_pool.read",
    "talent_pool.manage",
    "interview.read",
    "interview.manage",
    "scorecard.submit",
    "scorecard.read_all",
    "scorecard.finalize",
    "background_check.read",
    "background_check.manage",
    "offer.read",
    "offer.manage",
    "offer.approve",
    "offer.issue",
    "offer.withdraw",
    "candidate.convert_to_employee",
    "recruitment.reports.read",
    "attendance.read.own",
    "attendance.clock.own",
    "attendance.manage",
    "attendance.adjustment.approve",
    "performance.read.own",
    "performance.write.own",
    "performance.review.write",
    "performance.manage",
    "performance.finalize",
    "performance.reports.read",
    "learning.read.own",
    "learning.write.own",
    "learning.review.write",
    "learning.manage",
    "learning.reports.read",
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
    "application.manage",
    "candidate.read",
    "candidate.manage",
    "candidate.notes.read",
    "candidate.notes.write",
    "talent_pool.read",
    "talent_pool.manage",
    "interview.read",
    "interview.manage",
    "scorecard.submit",
    "scorecard.read_all",
    "scorecard.finalize",
    "background_check.read",
    "background_check.manage",
    "offer.read",
    "offer.manage",
    "offer.approve",
    "offer.issue",
    "offer.withdraw",
    "candidate.convert_to_employee",
    "recruitment.reports.read",
    "attendance.read.own",
    "attendance.clock.own",
    "attendance.manage",
    "attendance.adjustment.approve",
    "performance.read.own",
    "performance.write.own",
    "performance.review.write",
    "performance.manage",
    "performance.finalize",
    "performance.reports.read",
    "learning.read.own",
    "learning.write.own",
    "learning.review.write",
    "learning.manage",
    "learning.reports.read",
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
    "candidate.read",
    "candidate.notes.read",
    "interview.read",
    "scorecard.submit",
    "offer.read",
    "offer.manage",
    "recruitment.reports.read",
    "attendance.read.own",
    "attendance.clock.own",
    "performance.read.own",
    "performance.write.own",
    "performance.review.write",
    "performance.reports.read",
    "learning.read.own",
    "learning.write.own",
    "learning.review.write",
    "learning.reports.read",
  ],
};

async function main() {
  // roles.key has no plain unique constraint — only two partial ones
  // (roles_system_key_unique on key WHERE organization_id is null,
  // roles_org_key_unique on (organization_id, key) WHERE organization_id is
  // not null, per ADR-015's system/org-copy split). SYSTEM_ROLES are always
  // system templates (organizationId unset), so the conflict target must
  // carry the same partial condition as roles_system_key_unique or Postgres
  // rejects it with "no unique or exclusion constraint matching the ON
  // CONFLICT specification" (42P10).
  await db
    .insert(rolesTable)
    .values([...SYSTEM_ROLES])
    .onConflictDoNothing({ target: rolesTable.key, where: sql`${rolesTable.organizationId} is null` });
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
