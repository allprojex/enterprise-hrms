/**
 * System roles, the permission catalogue and the default role -> permission
 * mapping. Pure data, no database access, so the API server's tests and the
 * delegation guard can import it directly; seed-roles-permissions.ts is the
 * (idempotent) writer.
 */
export const SYSTEM_ROLES = [
  { key: "super_admin", label: "Super Admin", description: "Platform-wide access across all organizations." },
  {
    key: "org_admin",
    label: "Organization Admin",
    description: "Full administrative access within an organization.",
  },
  // CANONICAL HR ROLE (owner architecture decision, 2026-09-09). One operational
  // HR authority per organization, held by as many people as the organization
  // needs. It is NOT organization governance: org_admin keeps organization
  // identity, entitlement, membership/role administration and Primary HR
  // designation (see ORG_GOVERNANCE_ONLY_KEYS below). Primary HR remains a
  // separate organization-scoped DESIGNATION (primary_hr_assignments), never a
  // competing role — a Primary HR person should normally also hold this role.
  {
    key: "hr",
    label: "HR",
    description: "The organization's HR authority: full HR operations, HR form governance and controlled HR-team delegation, without organization or platform administration.",
  },
  // DEPRECATED (2026-09-09) — superseded by `hr`. Retained so existing
  // assignments keep working and historical audit records stay interpretable;
  // blocked from NEW assignment by DEPRECATED_ROLE_KEYS below. Do not delete:
  // audit events reference these keys by name and must remain truthful.
  { key: "hr_manager", label: "HR Manager (deprecated)", description: "Deprecated — superseded by HR. Manages HR records within an organization." },
  // Primary HR Administrator (platform capability, 2026-09-04): the organization's
  // principal HR administrator. Everything hr_manager has, plus office inventory,
  // HR-domain configuration and audit views, grievance/succession, and controlled
  // HR-team delegation (hr_team.manage). Deliberately WITHOUT organization/platform
  // administration — see artifacts/api-server/src/lib/roleDelegation.ts.
  {
    key: "hr_administrator",
    label: "HR Administrator (deprecated)",
    description: "Deprecated — superseded by HR. Principal HR administrator: full HR operations plus controlled HR-team delegation, without organization or platform administration.",
  },
  {
    key: "employee",
    label: "Employee",
    description: "Self-service access to own profile and organization info.",
  },
] as const;

export const PERMISSIONS = [
  { key: "organization.read", resource: "organization", action: "read" },
  { key: "organization.update", resource: "organization", action: "update" },
  { key: "membership.read", resource: "membership", action: "read" },
  { key: "membership.manage", resource: "membership", action: "manage" },
  // HR-team delegation (2026-09-04): invite/assign/revoke HR-operational roles only,
  // enforced server-side by the subset + prohibited-key rules in roleDelegation.ts,
  // and only for the organization's active Primary HR. Never grants membership.manage.
  { key: "hr_team.manage", resource: "hr_team", action: "manage" },
  { key: "primary_hr.manage", resource: "primary_hr", action: "manage" },
  { key: "employee.read", resource: "employee", action: "read" },
  { key: "employee.write", resource: "employee", action: "write" },
  { key: "employee.notes.read", resource: "employee", action: "notes.read" },
  { key: "employee.disciplinary.read", resource: "employee", action: "disciplinary.read" },
  // WWM Employee Access Remediation (2026-09-07): `employee.read` is the
  // organization's DIRECTORY grant (name, number, work email, department,
  // position, manager, status) and every role — including the employee
  // template — holds it so colleagues can find each other. It never
  // implied the right to a colleague's personal identity data. These two
  // field-category keys (same shape as employee.notes.read /
  // employee.disciplinary.read) now gate what the directory grant alone
  // must not reveal. A caller always sees their OWN full record regardless.
  //   employee.sensitive.read  — date of birth, gender, marital status,
  //     nationality, national ID, passport, personal email, phone number
  //     (added 2026-09-15: the field can hold a personal mobile), alternate
  //     phone, residential address, emergency contacts, separation reason.
  //   employee.documents.read  — another employee's personnel-document
  //     metadata (GET .../employees/:id/documents). Upload/delete stay on
  //     employee.write; there is no binary download route.
  // Granted to org_admin and hr_manager (hr_administrator inherits by
  // composition, super_admin by the blanket rule); never to employee.
  { key: "employee.sensitive.read", resource: "employee", action: "sensitive.read" },
  { key: "employee.documents.read", resource: "employee", action: "documents.read" },
  { key: "branch.read", resource: "branch", action: "read" },
  { key: "branch.manage", resource: "branch", action: "manage" },
  { key: "department.read", resource: "department", action: "read" },
  { key: "department.manage", resource: "department", action: "manage" },
  { key: "position.read", resource: "position", action: "read" },
  { key: "position.manage", resource: "position", action: "manage" },
  // "audit.read" is the pre-existing, broad "read every audit category"
  // permission — kept unchanged (super_admin/org_admin still hold it via
  // their existing grants below). WS-3 (Owner Decision #17) adds narrow,
  // category-scoped alternatives beneath it — a role can hold just one
  // category (e.g. hr_manager below, HR only) without the others. See
  // lib/auditCategories.ts for the category taxonomy and
  // lib/auditAuthorization.ts's resolveAllowedAuditCategories() for
  // how routes/auditEvents.ts resolves which categories a caller may see
  // (holding "audit.read" itself means "all categories", same as before).
  { key: "audit.read", resource: "audit", action: "read" },
  { key: "audit.read.hr", resource: "audit", action: "read.hr" },
  { key: "audit.read.payroll", resource: "audit", action: "read.payroll" },
  { key: "audit.read.security", resource: "audit", action: "read.security" },
  { key: "audit.read.documents", resource: "audit", action: "read.documents" },
  { key: "audit.read.assets_inventory", resource: "audit", action: "read.assets_inventory" },
  { key: "audit.read.platform_configuration", resource: "audit", action: "read.platform_configuration" },
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
  // Phase 3E, W95 — Asset Management Foundation. Exactly 4 keys, no
  // ".team"/".assign"/".maintenance"/".incidents"/".acknowledge" variant, per
  // docs/PHASE_3E_ASSETS_IMPLEMENTATION_PLAN.md §15 — the permission
  // namespace matches the module's own registry key (`asset_management`)
  // exactly, mirroring Learning's/Performance's/Attendance's own
  // flat-namespace-matches-module-key convention (not Leave's/Recruitment's
  // entity-level namespacing, since Assets is a single cohesive module).
  // Manager-of-record current-direct-report visibility is resolved
  // server-side via .read.own's/.reports.read's own relationship dispatch,
  // never a separate .read.team key. .write.own authorizes exactly two
  // later-workstream own-scoped actions (acknowledge own current
  // assignment, report own loss/damage incident) — never any authoritative
  // custody/status/condition/maintenance/retirement change, which remain
  // .manage-only.
  { key: "asset_management.read.own", resource: "asset_management", action: "read.own" },
  { key: "asset_management.write.own", resource: "asset_management", action: "write.own" },
  { key: "asset_management.manage", resource: "asset_management", action: "manage" },
  { key: "asset_management.reports.read", resource: "asset_management", action: "reports.read" },
  // Phase 3H, W114 — Numbering & Identifier History. The sole permission
  // this workstream introduces (frozen plan §13's other five
  // personnel_file.* keys belong to W115/W116, not seeded until those
  // workstreams land). Gates allocate/release/reuse of a staff number —
  // org_admin/hr_manager only, never employee, per the frozen plan's
  // explicit "no ESS self-service, no Manager Portal integration" boundary.
  // Numbering *configuration* (the "numbering" config namespace) reuses the
  // pre-existing organization.update permission instead of a new key here.
  { key: "employee_number.allocate", resource: "employee_number", action: "allocate" },
  // Phase 3H, W115 — Personnel File Registry & PIF Linkage. Two of the
  // frozen plan §13's six personnel_file.* keys — the two W115 actually
  // uses; .movement.write/.sensitive.read/.sensitive.write remain unseeded
  // until W116/a future sensitive-fields decision, per the "seed exactly
  // what the current workstream uses" convention every prior phase in this
  // codebase already established. org_admin/hr_manager only, never
  // employee — no ESS or Manager Portal visibility, per the frozen plan.
  { key: "personnel_file.read", resource: "personnel_file", action: "read" },
  { key: "personnel_file.manage", resource: "personnel_file", action: "manage" },
  // Phase 3H, W116 — Physical Filing, Locations & Movement. The third of the
  // frozen plan §13's six personnel_file.* keys — kept separable from
  // .manage on purpose (frozen plan §22/current prompt §23): a user who can
  // only view/manage the registry does not automatically gain the ability
  // to check files in/out. org_admin/hr_manager only, never employee.
  { key: "personnel_file.movement.write", resource: "personnel_file", action: "movement.write" },
  // Payroll, Workstream 1 (docs/PAYROLL_IMPLEMENTATION_PLAN.md §13/§14). The
  // full frozen payroll permission namespace is registered here in one pass
  // (the frozen plan explicitly assigns "all payroll.* permission keys" to
  // Workstream 1) even though only payroll.statutory.manage/.approve are
  // actually enforced by any route this workstream ships — every other key
  // is reserved for its own owning future workstream, the same "register
  // once, wire up as each workstream lands" precedent already used for
  // several Recruitment permissions (see the recruitment_settings comment
  // above). Deliberately NOT added to ANY existing ROLE_PERMISSIONS array
  // below (org_admin, hr_manager, employee) — per the Owner Review's own
  // explicit instruction that ordinary HR authority must not automatically
  // imply payroll authority. super_admin still receives every one of these
  // through the pre-existing `PERMISSIONS.map((p) => p.key)` blanket-grant
  // every permission in this file already receives — not a payroll-specific
  // broadening, and the Owner Review's "do not broaden" instruction named
  // org_admin/hr_manager/employee specifically, not super_admin. A payroll
  // administrator role must be explicitly created and assigned these keys
  // per organization before anyone can use them — no such assignment is
  // made by this workstream, for any organization, including WWM.
  { key: "payroll.statutory.manage", resource: "payroll", action: "statutory.manage" },
  { key: "payroll.statutory.approve", resource: "payroll", action: "statutory.approve" },
  { key: "payroll.compensation.read", resource: "payroll", action: "compensation.read" },
  { key: "payroll.compensation.manage", resource: "payroll", action: "compensation.manage" },
  // WS-7 closure — brought-forward payroll/statutory history at migration
  // cutover. Deliberately NOT folded into payroll.compensation.*: the Owner
  // decision that created this domain is precisely that an opening balance
  // is not compensation, and gating it on the compensation keys would
  // re-conflate the two in the authorization model. Like every other
  // payroll key above, these are registered but granted to NO role — payroll
  // authority is an explicit per-organization delegation, never implied by
  // HR authority (see the block comment above).
  { key: "payroll.opening_balance.read", resource: "payroll", action: "opening_balance.read" },
  { key: "payroll.opening_balance.manage", resource: "payroll", action: "opening_balance.manage" },
  { key: "payroll.banking.read", resource: "payroll", action: "banking.read" },
  { key: "payroll.banking.manage", resource: "payroll", action: "banking.manage" },
  { key: "payroll.statutory_identifiers.read", resource: "payroll", action: "statutory_identifiers.read" },
  { key: "payroll.statutory_identifiers.manage", resource: "payroll", action: "statutory_identifiers.manage" },
  { key: "payroll.run.prepare", resource: "payroll", action: "run.prepare" },
  { key: "payroll.run.approve", resource: "payroll", action: "run.approve" },
  { key: "payroll.run.lock", resource: "payroll", action: "run.lock" },
  { key: "payroll.run.correct", resource: "payroll", action: "run.correct" },
  { key: "payroll.payment.manage", resource: "payroll", action: "payment.manage" },
  { key: "payroll.report.read", resource: "payroll", action: "report.read" },
  { key: "payroll.payslip.read", resource: "payroll", action: "payslip.read" },
  { key: "payroll.payslip.read.own", resource: "payroll", action: "payslip.read.own" },
  // Office Inventory, Workstream 1
  // (docs/OFFICE_INVENTORY_IMPLEMENTATION_PLAN.md §38/§39). All 22 frozen
  // keys registered in one pass (mirroring Payroll's own W1 "register once,
  // wire up as each workstream lands" precedent) even though this
  // workstream only enforces item/store/Department-Head management —
  // every other key is reserved for its own owning future workstream.
  // `department.head.manage` is deliberately namespaced under the general
  // "department" resource, not "office_inventory" (§5.1) — a future module
  // could be granted the identical authority-reading/writing capability
  // without a rename. Deliberately NOT added to ANY existing
  // ROLE_PERMISSIONS array below (org_admin, hr_manager, employee) — per
  // the frozen plan's own explicit instruction that ordinary HR/org-admin
  // authority must not automatically imply Inventory (or Department Head)
  // authority. super_admin still receives every one of these through the
  // pre-existing `PERMISSIONS.map((p) => p.key)` blanket grant — not an
  // Inventory-specific broadening. An Inventory administrator role must be
  // explicitly created and assigned these keys per organization before
  // anyone can use them — no such assignment is made by this workstream,
  // for any organization, including WWM.
  // ROLE-02 (2026-09-15): the read half of Department Headship, split out
  // from `head.manage` so the organizational-structure role can see who
  // leads a department without also being able to appoint one. Reading an
  // assignment is not Department Head authority, so this does NOT contradict
  // the rule above that HR/org-admin authority must not imply Department
  // Head authority — `head.manage` remains withheld and unchanged.
  { key: "department.head.read", resource: "department", action: "head.read" },
  { key: "department.head.manage", resource: "department", action: "head.manage" },
  { key: "office_inventory.configure", resource: "office_inventory", action: "configure" },
  { key: "office_inventory.item.manage", resource: "office_inventory", action: "item.manage" },
  { key: "office_inventory.store.manage", resource: "office_inventory", action: "store.manage" },
  { key: "office_inventory.receive", resource: "office_inventory", action: "receive" },
  { key: "office_inventory.request", resource: "office_inventory", action: "request" },
  { key: "office_inventory.approve", resource: "office_inventory", action: "approve" },
  { key: "office_inventory.delegate.manage", resource: "office_inventory", action: "delegate.manage" },
  { key: "office_inventory.issue", resource: "office_inventory", action: "issue" },
  { key: "office_inventory.issue.direct", resource: "office_inventory", action: "issue.direct" },
  { key: "office_inventory.receipt.confirm.own", resource: "office_inventory", action: "receipt.confirm.own" },
  { key: "office_inventory.custody.read", resource: "office_inventory", action: "custody.read" },
  { key: "office_inventory.return", resource: "office_inventory", action: "return" },
  { key: "office_inventory.transfer", resource: "office_inventory", action: "transfer" },
  { key: "office_inventory.handover", resource: "office_inventory", action: "handover" },
  { key: "office_inventory.report_issue.own", resource: "office_inventory", action: "report_issue.own" },
  { key: "office_inventory.incident.review", resource: "office_inventory", action: "incident.review" },
  { key: "office_inventory.recover", resource: "office_inventory", action: "recover" },
  { key: "office_inventory.adjust", resource: "office_inventory", action: "adjust" },
  { key: "office_inventory.writeoff", resource: "office_inventory", action: "writeoff" },
  { key: "office_inventory.stocktake", resource: "office_inventory", action: "stocktake" },
  { key: "office_inventory.asset_handoff", resource: "office_inventory", action: "asset_handoff" },
  { key: "office_inventory.reports.read", resource: "office_inventory", action: "reports.read" },
  // VR-02 — Vehicle Requests. Exactly four keys, and deliberately no fifth:
  //   * reading YOUR OWN requests needs no key at all — "owning your own data
  //     is not an operational grant" (the ESS precedent that officeInventoryEss
  //     states outright), so ownership is proved server-side from the caller's
  //     own membership instead;
  //   * configuring the approval chain is administration of the vehicle domain,
  //     so it reuses the existing `asset_management.manage` rather than adding
  //     a `vehicle_request.configure`.
  // These are NOT the rejected `vehicle.read`/`vehicle.manage` pair: VR-01's
  // register stays on `asset_management.manage`, and none of these four grants
  // any access to it.
  { key: "vehicle_request.write.own", resource: "vehicle_request", action: "write.own" },
  { key: "vehicle_request.write.department", resource: "vehicle_request", action: "write.department" },
  { key: "vehicle_request.approve", resource: "vehicle_request", action: "approve" },
  { key: "vehicle_request.read.all", resource: "vehicle_request", action: "read.all" },
  // WS-5 — Documents & Records Foundation (Owner Decision #4). Deliberately
  // seven keys, not one per document category (§32 explicitly forbids
  // category-specific keys). The split follows the authority boundaries the
  // frozen scope draws, not the table layout:
  //
  //   .read/.manage    — the organization-level document repository.
  //   .verify          — §13: uploading a document is not verifying it, so
  //                      verification authority is separable from the
  //                      ability to upload.
  //   .retention.manage— archive/legal-hold/disposal (§15-17). Separable
  //                      from .manage on the same least-privilege reasoning
  //                      W116 used to keep personnel_file.movement.write
  //                      out of personnel_file.manage: someone who maintains
  //                      documents does not thereby get to dispose of them.
  //   .sensitive.read  — reading a category the organization marked
  //                      confidential (§34).
  //
  // Existing employee/candidate document routes keep their current
  // employee.*/recruitment gates untouched (§32 "reuse existing permissions
  // where they are semantically correct", §55 regression) — these keys gate
  // only the surfaces WS-5 introduces.
  //
  // Granted below to org_admin and hr_manager (the roles that already hold
  // personnel_file.read/.manage — digital records authority belongs with the
  // same records-officer function), except `.retention.manage`, which is
  // registered but assigned to no role: authorizing destruction of records
  // is a deliberate per-organization delegation, following the same
  // "register once, assign explicitly" precedent Payroll/Office Inventory
  // established. super_admin receives all of them only through the
  // pre-existing blanket grant.
  { key: "organization_document.read", resource: "organization_document", action: "read" },
  { key: "organization_document.manage", resource: "organization_document", action: "manage" },
  { key: "organization_document.sensitive.read", resource: "organization_document", action: "sensitive.read" },
  { key: "document.verify", resource: "document", action: "verify" },
  { key: "document.retention.manage", resource: "document", action: "retention.manage" },
  { key: "document_template.read", resource: "document_template", action: "read" },
  { key: "document_template.manage", resource: "document_template", action: "manage" },
  // WS-7 — Bulk Import / Multi-Entity Migration. A dedicated three-key
  // triad rather than reusing employee.write/personnel_file.manage: a
  // migration writes across SIX domains at once (structure, employees,
  // staff/PIF numbers, employment history, qualifications/certifications,
  // leave balances, payroll compensation), so no single existing key is
  // semantically correct for it, and composing the full union of underlying
  // keys on every route would make "who can run an import" impossible to
  // reason about or delegate.
  //
  //   .read    — view migration batches, their staged rows, dry-run results
  //              and reconciliation reports. Read-only; sees imported HR
  //              content only insofar as it is staged data awaiting import.
  //   .manage  — create a batch, upload/map sources, run validation and the
  //              dry run, cancel a batch. Everything EXCEPT committing.
  //   .execute — approve an already-validated batch and commit it to live
  //              data. Deliberately separable from .manage on the same
  //              least-privilege reasoning W116 used for
  //              personnel_file.movement.write and WS-5 used for
  //              document.retention.manage: preparing an import is not
  //              authorizing it, and a bulk commit is the single most
  //              consequential write this platform offers.
  //
  // Granted below to org_admin only (all three). hr_manager receives
  // `.read` alone — an HR manager can see and audit a migration in
  // progress, but running one is an organization-administration act, per
  // the Owner's "dedicated narrow authority" instruction for this
  // workstream. super_admin receives all three via the pre-existing blanket
  // grant.
  // WS-8 — Custom Fields & Form Builder (see MASTER_OWNER_REVIEW §24.25).
  // A compact four-key model, deliberately NOT per-field ACLs (§24.15):
  // authorization for a VALUE follows the target domain permission
  // (employee.read/.write, candidate.*, position.*, organization.*), while
  // these four gate the CONFIGURATION surface. Revealing a sensitive custom
  // value additionally requires custom_fields.sensitive.read.
  { key: "custom_fields.read", resource: "custom_fields", action: "read" },
  { key: "custom_fields.manage", resource: "custom_fields", action: "manage" },
  { key: "custom_fields.sensitive.read", resource: "custom_fields", action: "sensitive.read" },
  { key: "custom_forms.read", resource: "custom_forms", action: "read" },
  { key: "custom_forms.manage", resource: "custom_forms", action: "manage" },
  { key: "migration.read", resource: "migration", action: "read" },
  { key: "migration.manage", resource: "migration", action: "manage" },
  { key: "migration.execute", resource: "migration", action: "execute" },
  // WS-10 — Onboarding, Induction & Handbook.
  //
  // The compact four-key model frozen in §26.31, deliberately not a matrix.
  // `onboarding.configure` gates the TEMPLATE surface (organization
  // configuration); `onboarding.manage` gates operating someone's onboarding
  // (starting, waiving, cancelling, assigning a handbook);
  // `onboarding.task.complete` is the narrower right to complete a task on
  // another person's behalf; `onboarding.read` is HR-wide visibility.
  //
  // No acknowledgement key is minted: an employee acknowledging their OWN
  // assigned document is authorized by self-scope (their employee_user_link),
  // never by a permission grant — and assigning is already `onboarding.manage`.
  // WS-11 — Employment Lifecycle Events Expansion (§27).
  //
  // Three keys, deliberately not a matrix. Confirmation, transfer, promotion,
  // separation and rehire keep their existing `employee.write` gate untouched —
  // §27.21 forbids redesigning those services, and re-gating them would be a
  // silent authorization change to shipped behaviour.
  //
  // These three cover only what WS-11 adds: contract terms, probation
  // extension/outcome, and acting/secondment assignments.
  { key: "employment_lifecycle.read", resource: "employment_lifecycle", action: "read" },
  { key: "employment_lifecycle.manage", resource: "employment_lifecycle", action: "manage" },
  { key: "employment_lifecycle.configure", resource: "employment_lifecycle", action: "configure" },
  // WS-12 — Employee Relations & Offboarding Clearance (§28.17).
  //
  // `employee.disciplinary.read` is NOT redefined, NOT renamed and NOT removed.
  // It is a shipped key with shipped grants, and §28.17 preserves it exactly:
  // silently revoking an existing authorization is the change §27.21 warns
  // against. The new disciplinary keys sit alongside it — `read` for the
  // structured cases, `manage` for acting on them.
  //
  // GRIEVANCE IS DELIBERATELY NOT COVERED BY ANY DISCIPLINARY KEY. §28.4 and
  // §28.17: a grievance is raised BY an employee, often about someone with
  // disciplinary authority, so inheriting grievance visibility from the
  // disciplinary permission would hand the likely respondent a window onto the
  // complaint. It requires its own explicit grant, and organization
  // administration does not receive it by default (see the org_admin block).
  { key: "employee_relations.read", resource: "employee_relations", action: "read" },
  { key: "employee_relations.manage", resource: "employee_relations", action: "manage" },
  { key: "grievance.read", resource: "grievance", action: "read" },
  { key: "grievance.manage", resource: "grievance", action: "manage" },
  { key: "offboarding.read", resource: "offboarding", action: "read" },
  { key: "offboarding.manage", resource: "offboarding", action: "manage" },
  // Template authority is separated from operational authority, the same
  // WS-8/WS-10/WS-11 split: defining what every departing person must clear is
  // an organization-configuration act, not a day-to-day one.
  { key: "offboarding.configure", resource: "offboarding", action: "configure" },
  // Held by a clearance approver who is NOT HR — a stores officer, an IT desk,
  // a department head. It authorizes acting on an assigned clearance item and
  // nothing else: it grants no case access, no grievance access, and no ability
  // to grant final clearance.
  { key: "clearance.act", resource: "clearance", action: "act" },
  // WS-13 — Employee Data Change Approval & HR Service Requests (§29.18).
  //
  // EMPLOYEE SELF-SERVICE MINTS NO KEY. An employee's right to raise a request
  // about their own data comes from their employee link, resolved server-side —
  // the precedent WS-10 and WS-12 both set. A right an administrator could
  // withhold is not self-service.
  //
  // Approval is separated from proposal so maker-checker (§29.6) is expressible
  // as an authorization fact and not only as a runtime check, and configuration
  // is separated from operation, mirroring the WS-8/WS-10/WS-11/WS-12 split.
  { key: "data_change.read", resource: "data_change", action: "read" },
  { key: "data_change.request", resource: "data_change", action: "request" },
  { key: "data_change.approve", resource: "data_change", action: "approve" },
  { key: "data_change.configure", resource: "data_change", action: "configure" },
  { key: "service_request.read", resource: "service_request", action: "read" },
  { key: "service_request.manage", resource: "service_request", action: "manage" },
  { key: "service_request.approve", resource: "service_request", action: "approve" },
  { key: "service_request.configure", resource: "service_request", action: "configure" },
  // WS-14 — Skills, Competency Framework & Succession (§30.22).
  //
  // ASSESSMENT AND VERIFICATION ARE SEPARATE KEYS because §30.8 makes them
  // separate acts: a manager may record what they observed, and confirming it
  // as organizational truth is a different authority.
  //
  // The three succession keys are separate from every skills key because
  // succession is confidential HR information (§30.17) and its audience is
  // narrower than the audience for capability data.
  //
  // No self-service key is minted: an employee's right to see and claim their
  // own capability comes from their employee link, the precedent WS-10, WS-12
  // and WS-13 all set.
  //
  // No separate reporting key: each read model is gated on the same key as the
  // records it aggregates, so a reporting key would be redundant.
  { key: "skill_catalogue.read", resource: "skill_catalogue", action: "read" },
  { key: "skill_catalogue.configure", resource: "skill_catalogue", action: "configure" },
  { key: "employee_skill.read", resource: "employee_skill", action: "read" },
  { key: "employee_skill.manage", resource: "employee_skill", action: "manage" },
  { key: "skill_assessment.record", resource: "skill_assessment", action: "record" },
  { key: "skill_verification.decide", resource: "skill_verification", action: "decide" },
  { key: "position_requirement.read", resource: "position_requirement", action: "read" },
  { key: "position_requirement.configure", resource: "position_requirement", action: "configure" },
  { key: "succession.read", resource: "succession", action: "read" },
  { key: "succession.manage", resource: "succession", action: "manage" },
  { key: "succession.confidential.read", resource: "succession", action: "confidential.read" },
  { key: "onboarding.read", resource: "onboarding", action: "read" },
  { key: "onboarding.manage", resource: "onboarding", action: "manage" },
  { key: "onboarding.configure", resource: "onboarding", action: "configure" },
  { key: "onboarding.task.complete", resource: "onboarding", action: "task.complete" },
  // WS-26 — Tenant Form, Workflow & Signature Engine. Template administration
  // is organization configuration (manage/publish split like WS-8/WS-10);
  // submitting one's own form needs no key — it comes from the employee link.
  { key: "form_template.manage", resource: "form_template", action: "manage" },
  { key: "form_template.publish", resource: "form_template", action: "publish" },
  { key: "form.read", resource: "form", action: "read" },
  { key: "form.assess", resource: "form", action: "assess" },
  { key: "form.approve", resource: "form", action: "approve" },
  { key: "form.finalize", resource: "form", action: "finalize" },
  { key: "form.signature.apply", resource: "form", action: "signature.apply" },
  // Raising a form submission FOR ANOTHER EMPLOYEE. Deliberately separate from
  // form.assess (assessor-stage participation), which used to authorize this by
  // accident and no longer does. Assisted completion is an exception path with
  // its own reason, provenance and audit, so it gets its own key.
  { key: "form_submission.create_on_behalf", resource: "form_submission", action: "create_on_behalf" },
  { key: "form.final.read", resource: "form", action: "final.read" },
] as const;

export const ROLE_PERMISSIONS: Record<string, readonly string[]> = {
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
    "employee.sensitive.read",
    "employee.documents.read",
    "branch.read",
    "branch.manage",
    "department.read",
    "department.manage",
    // ROLE-02: org_admin creates, renames and deletes departments and manages
    // memberships, so it must be able to see who heads one. Read only —
    // department.head.manage stays withheld from this role.
    "department.head.read",
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
    "asset_management.read.own",
    "asset_management.write.own",
    "asset_management.manage",
    "asset_management.reports.read",
    "employee_number.allocate",
    "personnel_file.read",
    "personnel_file.manage",
    "personnel_file.movement.write",
    // WS-5 — see the permission block above for why .retention.manage is
    // deliberately absent from every seeded role.
    "organization_document.read",
    "organization_document.manage",
    "organization_document.sensitive.read",
    "document.verify",
    "document_template.read",
    "document_template.manage",
    // WS-7 — org_admin holds the full migration triad: preparing, approving
    // and committing a bulk import is an organization-administration act.
    "migration.read",
    "migration.manage",
    "migration.execute",
    // WS-8 — organization administration owns configuration.
    // custom_fields.sensitive.read is registered but granted to NO role,
    // following the payroll precedent: revealing sensitive data is an
    // explicit per-organization delegation, never implied by admin rights.
    "custom_fields.read",
    "custom_fields.manage",
    "custom_forms.read",
    "custom_forms.manage",
    // WS-11 — organization administration owns lifecycle configuration and
    // operation alike.
    "employment_lifecycle.read",
    "employment_lifecycle.manage",
    "employment_lifecycle.configure",
    // WS-12 — organization administration owns employee-relations and
    // offboarding operation and configuration alike, and KEEPS the shipped
    // `employee.disciplinary.read` grant further down this list untouched
    // (§28.17).
    //
    // `grievance.read` and `grievance.manage` are deliberately ABSENT. §28.17:
    // Organization Admin status alone must not expose confidential grievance
    // records — a grievance may be about the administrator, or about someone
    // they line-manage. Grievance authority is an explicit per-organization
    // delegation, following the same precedent that withholds
    // `custom_fields.sensitive.read` from every role above.
    "employee_relations.read",
    "employee_relations.manage",
    "offboarding.read",
    "offboarding.manage",
    "offboarding.configure",
    "clearance.act",
    // WS-13 — organization administration owns request configuration and
    // operation alike. It also holds approve: an administrator is a legitimate
    // approver, and maker-checker still stops them approving their OWN request
    // (§29.6) — that rule is enforced per request, not per role.
    "data_change.read",
    "data_change.request",
    "data_change.approve",
    "data_change.configure",
    "service_request.read",
    "service_request.manage",
    "service_request.approve",
    "service_request.configure",
    // WS-14 — organization administration owns capability configuration and
    // operation.
    //
    // The three succession keys are deliberately ABSENT (§30.17). Succession is
    // confidential HR information, a plan may concern the administrator or
    // somebody they line-manage, and administrative rank is not the same thing
    // as a need to see who is being lined up for a role. This mirrors exactly
    // what §28.17 did with grievance access, and the same
    // `custom_fields.sensitive.read` precedent of registering a key that no
    // role receives by default.
    "skill_catalogue.read",
    "skill_catalogue.configure",
    "employee_skill.read",
    "employee_skill.manage",
    "skill_assessment.record",
    "skill_verification.decide",
    "position_requirement.read",
    "position_requirement.configure",
    // WS-10 — organization administration owns onboarding configuration and
    // operation alike.
    "onboarding.read",
    "onboarding.manage",
    "onboarding.configure",
    "onboarding.task.complete",
    // WS-26 — organization administration owns form templates and their
    // publication, and every form operation.
    "form_template.manage",
    "form_template.publish",
    "form.read",
    "form.assess",
    "form.approve",
    "form.finalize",
    "form.signature.apply",
    "form.final.read",
  ],
  hr_manager: [
    // WS-14 — an HR manager runs capability and succession day to day but does
    // not define the organization's catalogue or proficiency scale, so
    // `skill_catalogue.configure` is withheld — the same configuration-versus-
    // operation split as WS-8, WS-10, WS-11, WS-12 and WS-13.
    //
    // All three succession keys ARE granted here, unlike to org_admin: running
    // succession is the HR function, and §30.17's concern is that succession
    // visibility must be an explicit grant rather than a side effect of
    // administrative rank. Granting it to the role whose job it is, and
    // withholding it from the role that merely outranks everyone, is exactly
    // that distinction.
    "skill_catalogue.read",
    "employee_skill.read",
    "employee_skill.manage",
    "skill_assessment.record",
    "skill_verification.decide",
    "position_requirement.read",
    "position_requirement.configure",
    "succession.read",
    "succession.manage",
    "succession.confidential.read",
    "organization.read",
    "membership.read",
    // WS-3 (Owner Decision #17): a genuine, new grant — hr_manager held no
    // audit visibility at all before this workstream (only org_admin/
    // super_admin held the broad "audit.read"). Scoped to HR-category
    // events only — Payroll/Security/Documents/Assets/Platform-Config audit
    // history remains invisible to this role.
    "audit.read.hr",
    "employee.read",
    "employee.write",
    "employee.notes.read",
    "employee.disciplinary.read",
    "employee.sensitive.read",
    "employee.documents.read",
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
    "asset_management.read.own",
    "asset_management.write.own",
    "asset_management.manage",
    "asset_management.reports.read",
    "employee_number.allocate",
    "personnel_file.read",
    "personnel_file.manage",
    "personnel_file.movement.write",
    // WS-5 — same set as org_admin: hr_manager already holds the equivalent
    // physical-records authority (personnel_file.*), so digital records
    // authority belongs here too. .retention.manage remains unassigned.
    "organization_document.read",
    "organization_document.manage",
    "organization_document.sensitive.read",
    "document.verify",
    "document_template.read",
    "document_template.manage",
    // WS-8 — an HR manager reads field configuration (needed to make sense of
    // what appears on employee records) and manages forms, but does not define
    // the underlying fields, which is an organization-configuration act.
    "custom_fields.read",
    "custom_forms.read",
    "custom_forms.manage",
    // WS-7 — read-only, deliberately narrower than org_admin (and narrower
    // than the WS-5/WS-6 precedent of giving hr_manager the same set): an
    // HR manager can see and audit a migration, but preparing/approving/
    // committing one is reserved to organization administration.
    "migration.read",
    // WS-11 — an HR manager operates the employment lifecycle day to day
    // (contract terms, probation extension/outcome, acting and secondment) but
    // does not set the organization's lifecycle POLICY. `configure` is withheld
    // here, mirroring the WS-8/WS-10 split: configuration authority is not the
    // same thing as operational authority (§27.17).
    "employment_lifecycle.read",
    "employment_lifecycle.manage",
    // WS-12 — an HR manager runs employee relations and offboarding day to day
    // but does not define the organization's clearance templates, so
    // `offboarding.configure` is withheld, mirroring the WS-8/WS-10/WS-11 split.
    //
    // `grievance.read`/`grievance.manage` ARE granted here, unlike to
    // org_admin: handling grievances is the HR function, and §28.17's concern
    // is that grievance visibility must be an explicit grant rather than a
    // side effect of administrative rank. Granting it to the role whose job it
    // is, and withholding it from the role that merely outranks everyone, is
    // exactly that distinction.
    "employee_relations.read",
    "employee_relations.manage",
    "grievance.read",
    "grievance.manage",
    "offboarding.read",
    "offboarding.manage",
    "clearance.act",
    // WS-13 — an HR manager runs requests day to day and approves them, but does
    // not define the organization's eligible-field policy or request catalogue.
    // Both `configure` keys are withheld, the same split as above.
    "data_change.read",
    "data_change.request",
    "data_change.approve",
    "service_request.read",
    "service_request.manage",
    "service_request.approve",
    // WS-10 — an HR manager runs onboarding day to day (starts it, completes
    // and waives tasks, assigns handbooks) but does not define the templates
    // themselves, which is an organization-configuration act. This mirrors the
    // WS-8 split exactly: `onboarding.configure` is withheld here.
    "onboarding.read",
    "onboarding.manage",
    "onboarding.task.complete",
    // WS-26 — HR runs forms day to day and may draft templates, but
    // publishing a template is an organization-configuration act and is
    // withheld here (same split as onboarding.configure above).
    "form_template.manage",
    "form.read",
    "form.assess",
    "form.approve",
    "form.finalize",
    "form.signature.apply",
    "form.final.read",
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
    "asset_management.read.own",
    "asset_management.write.own",
    "asset_management.reports.read",
    // VR-02 — an ordinary employee may raise a vehicle request for themselves.
    // ONLY this key: `write.department`, `approve` and `read.all` are
    // deliberately absent from every template and are granted per organization,
    // so no employee acquires departmental, approval or oversight reach here.
    "vehicle_request.write.own",
  ],
};


// ---------------------------------------------------------------------------
// hr_administrator — composed, not hand-listed, so it can never drift below
// hr_manager. Owner decisions (2026-09-04): no payroll keys at this stage; none
// of the organization/platform administration keys (see
// HR_DELEGATION_PROHIBITED_KEYS in the API server); membership.read so the
// HR team can be seen; hr_team.manage for controlled delegation.
// ---------------------------------------------------------------------------
const HR_ADMINISTRATOR_ADDITIONS: readonly string[] = [
  "membership.read",
  "hr_team.manage",
  ...PERMISSIONS.map((p) => p.key).filter((k) => k.startsWith("office_inventory.")),
  "employment_lifecycle.configure",
  "onboarding.configure",
  "offboarding.configure",
  "data_change.configure",
  "service_request.configure",
  "skill_catalogue.configure",
  "custom_fields.manage",
  "custom_fields.sensitive.read",
  "master_data.manage",
  "document.retention.manage",
  "department.head.manage",
  // ROLE-02: held explicitly as well as implied by head.manage above, so HR's
  // read does not depend on the manage grant it happens to also carry.
  "department.head.read",
  "audit.read.hr",
  "audit.read.documents",
  "audit.read.assets_inventory",
  "grievance.read",
  "grievance.manage",
  "succession.read",
  "succession.manage",
  "succession.confidential.read",
];
ROLE_PERMISSIONS.hr_administrator = [...new Set([...ROLE_PERMISSIONS.hr_manager, ...HR_ADMINISTRATOR_ADDITIONS])];

// ---------------------------------------------------------------------------
// hr — the canonical HR role (owner architecture decision, 2026-09-09).
//
// Composed from hr_administrator so it can never drift BELOW the authority the
// deprecated roles already carry: every existing HR holder keeps everything
// they have when migrated. The only addition is form_template.publish.
//
// Why that key moves: publishing an HR form template is HR content
// administration, not organization governance. It was the single HR-operational
// key that sat on the org_admin side, which is why WS-26 could not find a
// legitimate HR publisher (org_admin/super_admin were the only holders).
// org_admin keeps it too — this grants, it never revokes.
//
// Deliberately NOT added, and asserted by tests: payroll.* (a separate licensed
// module), the organization-governance keys in ORG_GOVERNANCE_ONLY_KEYS, and
// the platform/security audit keys. Module and licence gates remain
// authoritative above all of this — HR authority never reaches a disabled
// module, because module enablement is enforced independently of permissions.
// ---------------------------------------------------------------------------
export const CANONICAL_HR_ROLE_KEY = "hr";

const HR_CANONICAL_ADDITIONS: readonly string[] = ["form_template.publish", "form_submission.create_on_behalf"];
ROLE_PERMISSIONS.hr = [...new Set([...ROLE_PERMISSIONS.hr_administrator, ...HR_CANONICAL_ADDITIONS])];

/**
 * Role templates that still exist (so current holders keep working and old
 * audit records stay interpretable) but may never be assigned again. Enforced
 * at the single assignment chokepoint: roleDelegationVerdict in
 * artifacts/api-server/src/lib/roleDelegation.ts. Revocation stays allowed —
 * otherwise existing holders could never be migrated off them.
 */
export const DEPRECATED_ROLE_KEYS: readonly string[] = ["hr_administrator", "hr_manager"];

/**
 * The organization-governance authority that HR must never acquire merely by
 * being HR. These stay org_admin-only; the consolidation is asserted against
 * this list so a future edit cannot quietly hand governance to HR.
 */
export const ORG_GOVERNANCE_ONLY_KEYS: readonly string[] = [
  "organization.update",
  "membership.manage",
  "role.manage",
  "module.manage",
  "primary_hr.manage",
  "migration.manage",
  "migration.execute",
  "audit.read",
];

// Sanity: every mapped key must exist in the catalogue (caught at seed time and by tests).
const CATALOGUE = new Set<string>(PERMISSIONS.map((p) => p.key));
for (const [role, keys] of Object.entries(ROLE_PERMISSIONS)) {
  for (const key of keys) {
    if (!CATALOGUE.has(key)) throw new Error(`ROLE_PERMISSIONS.${role} references unknown permission "${key}"`);
  }
}
