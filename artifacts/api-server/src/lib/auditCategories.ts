/**
 * WS-3 (Audit & Sensitive-Data Security Hardening, Owner Decision #17) —
 * the single, central mapping from an audit `event_type`'s prefix (the text
 * before its first ".", e.g. "payroll_banking" in "payroll_banking.read") to
 * one of the six audit categories. This is the ONE place a new event-type
 * prefix needs registering; recordAuditEvent() (auditLog.ts) calls this
 * automatically for every write, so none of the ~340 existing call sites
 * needed to change.
 *
 * Built from a repository-wide inventory of every literal `eventType:`
 * prefix actually in use at the time this workstream was written (verified
 * by grep, not guessed) — every prefix below is real, not speculative.
 *
 * Unmapped/future prefixes default to "security" — the most restrictive
 * category — deliberately fail-closed: it is safer for a not-yet-
 * categorized new event type to be under-exposed (visible only to whoever
 * holds the narrowest audit permission) than over-exposed to every HR-audit
 * reader by accident. This also gives Owner Decision #31's future break-
 * glass/support-access events (not built in WS-3) a correct home with zero
 * further categorization work once their event-type prefixes are chosen.
 */
export type AuditCategory = "hr" | "payroll" | "security" | "documents" | "assets_inventory" | "platform_configuration";

const CATEGORY_BY_PREFIX: Record<string, AuditCategory> = {
  // --- security: identity, access, platform-user administration ---
  session: "security",
  role: "security",
  membership: "security",
  primary_hr: "security",
  platform_user: "security",
  // A login's own account profile (PATCH /users/me). Identity data, so it sits
  // with the other identity events rather than with HR record changes.
  user: "security",
  // WS-4 (Break-Glass Access Foundation, Owner Decision #31): every grant
  // lifecycle event (activated/revoked) is security-category by nature —
  // this is the one prefix the pre-existing fail-closed default already
  // anticipated (see this file's own comment history), registered
  // explicitly here for clarity rather than left to fall through.
  break_glass_grant: "security",
  // WS-16 Pass 2B (§32.10, Owner Decisions #14/#15): the shared
  // authority-delegation foundation. Security-category rather than "hr"
  // or the module-scoped "assets_inventory" that office_inventory_delegation
  // carries, because this table is module-neutral and what it records is an
  // ACCESS-CONTROL change — one person temporarily gaining the standing to
  // act with another's authority. It sits with membership/role for exactly
  // that reason. The fail-closed default would already land here; it is
  // registered explicitly because this file is the one place categorization
  // happens.
  authority_delegation: "security",

  // --- payroll ---
  payroll_banking: "payroll",
  payroll_compensation: "payroll",
  // WS-7 closure: brought-forward payroll/statutory history imported at
  // migration cutover. Payroll-category, not "hr" and not the migration
  // batch's own platform_configuration category — the record itself is
  // payroll data and belongs with payroll's audit visibility rules.
  payroll_opening_balance: "payroll",
  payroll_correction: "payroll",
  payroll_input_reference: "payroll",
  payroll_payment_batch: "payroll",
  payroll_period: "payroll",
  payroll_run: "payroll",
  payroll_statutory_identifier: "payroll",
  payroll_statutory_identifiers: "payroll",
  payroll_statutory_rule: "payroll",

  // --- documents / records ---
  employee_document: "documents",
  personnel_file: "documents",
  personnel_file_volume: "documents",
  personnel_records: "documents",
  records_location: "documents",
  // WS-5 (Documents & Records Foundation, Owner Decision #4): the digital
  // documents domain — the organization-level repository, the shared
  // requirement/verification checklist, retention/legal-hold/disposal, and
  // the template/generation engine. Registered here for the same reason
  // every prefix above is: this is the one place categorization happens, so
  // no WS-5 call site passes a category itself.
  organization_document: "documents",
  document_requirement: "documents",
  document_retention: "documents",
  document_template: "documents",
  document_category: "documents",
  generated_document: "documents",
  // WS-26 official forms. A template/version defines an official document
  // (it renders to a finalized PDF), the same kind of thing document_template
  // is; a signature asset is a stored personal signature image. Both belong
  // with documents. Submission lifecycle events (form.*) are HR content — see
  // the `form` entry with custom_form_submission below. These prefixes had
  // been falling through to the fail-closed "security" default; events already
  // written keep the category they were stored with.
  form_template: "documents",
  signature_asset: "documents",

  // --- assets / inventory ---
  asset: "assets_inventory",
  asset_assignment: "assets_inventory",
  asset_evidence: "assets_inventory",
  asset_incident: "assets_inventory",
  asset_maintenance: "assets_inventory",
  office_inventory_adjustment: "assets_inventory",
  office_inventory_asset_handoff: "assets_inventory",
  office_inventory_delegation: "assets_inventory",
  office_inventory_direct_issue: "assets_inventory",
  office_inventory_handover: "assets_inventory",
  office_inventory_incident: "assets_inventory",
  office_inventory_issue: "assets_inventory",
  office_inventory_item: "assets_inventory",
  office_inventory_missing: "assets_inventory",
  office_inventory_receipt: "assets_inventory",
  office_inventory_request: "assets_inventory",
  office_inventory_request_line: "assets_inventory",
  office_inventory_return: "assets_inventory",
  office_inventory_stocktake: "assets_inventory",
  office_inventory_stocktake_line: "assets_inventory",
  office_inventory_store: "assets_inventory",
  office_inventory_transfer: "assets_inventory",
  office_inventory_writeoff: "assets_inventory",

  // --- platform / configuration ---
  organization: "platform_configuration",
  organization_domain: "platform_configuration",
  // tenant identity hardening — per-tenant feature flags / controlled
  // extensions, set only by platform super_admins through an audited,
  // tenant-targeted operation (routes/platformTenants.ts).
  feature_flag: "platform_configuration",
  // WS-6 (Scheduled Jobs / Notifications Foundation, Owner Decision #13):
  // administrative actions on the platform-wide job scheduler (manual
  // cancel/reschedule/retry, all gated to super_admin — see
  // routes/scheduledJobs.ts). Never routine scheduling or execution, which
  // this codebase deliberately does not audit (§31 of the brief: "do not
  // flood the audit table with every normal background execution") — the
  // job row's own attemptCount/lastErrorClass/lastErrorMessage already
  // carries that operational history.
  scheduled_job: "platform_configuration",
  // WS-7 (Bulk Import / Multi-Entity Migration): the migration BATCH
  // lifecycle only — created, source uploaded/mapped, validated, approved,
  // executed, cancelled. Deliberately platform_configuration rather than
  // "hr", even though the rows a migration writes are HR content: every
  // such row is already audited under its own domain prefix by the domain
  // primitive that writes it (employee_number.*, personnel_file.*,
  // employee_qualification.*, leave_balance.*, payroll_compensation.*),
  // so categorizing the batch envelope as "hr" too would double-file the
  // same import under two categories. What `migration.*` records is the
  // administrative act of running an import — the same shape as
  // scheduled_job above.
  migration: "platform_configuration",
  // WS-4 (Installation Registry, Owner Decision #29): deployment/runtime
  // identity administration — platform-scoped, never HR content.
  installation: "platform_configuration",
  module: "platform_configuration",
  master_data_item: "platform_configuration",
  // WS-8 — custom field and form DEFINITIONS are organization configuration,
  // so their lifecycle events belong with the other configuration prefixes.
  // A sensitive custom VALUE reveal is a different thing and is categorized
  // by the domain it was read from, via custom_field_value below.
  custom_field: "platform_configuration",
  custom_form: "platform_configuration",
  // Reading/correcting an actual stored value is HR content, not configuration.
  custom_field_value: "hr",
  custom_form_submission: "hr",
  // WS-26 form submissions: raised, submitted, approved/returned/rejected,
  // signed, finalized, downloaded — HR content, like custom_form_submission.
  form: "hr",
  numbering_config: "platform_configuration",
  branch: "platform_configuration",
  department: "platform_configuration",
  department_head: "platform_configuration",
  position: "platform_configuration",
  recruitment_settings: "platform_configuration",
  recruitment_stage: "platform_configuration",
  recruitment_workflow: "platform_configuration",
  public_holiday: "platform_configuration",
  leave_policy: "platform_configuration",
  leave_type: "platform_configuration",
  performance_rating_scale: "platform_configuration",
  performance_review_template: "platform_configuration",

  // --- hr: core workforce/people-process events ---
  employee: "hr",
  employee_certification: "hr",
  employee_conversion: "hr",
  employee_disciplinary_record: "hr",
  employee_exit_process: "hr",
  // WS-12 (§28.12). These stay "hr" ON PURPOSE. OD #18 requires sensitive-read
  // AUDITING of disciplinary and grievance evidence — that a read is recorded
  // at all — which is implemented in sensitiveRead.ts. It does not ask for the
  // resulting audit events to be re-categorized, and moving them to "security"
  // would quietly REMOVE them from the view of the HR auditors who hold
  // audit-read for the "hr" category (OD #17). That would be a silent
  // authorization change of exactly the kind §28.17 refuses elsewhere. The
  // sensitivity of the underlying record is enforced by the domain permission
  // and by the confidentiality tier, not by hiding its audit trail from HR.
  disciplinary_case: "hr",
  disciplinary_case_event: "hr",
  grievance_case: "hr",
  grievance_case_event: "hr",
  clearance_template: "hr",
  clearance_item: "hr",
  exit_interview: "hr",
  employee_relations_evidence: "hr",
  // WS-13 (§29.19). "hr" for the same reason WS-12's are: these are people-
  // process events, and an HR auditor holding OD #17's category-scoped
  // `audit.read.hr` must be able to see the request trail and the change trail
  // together. Moving them elsewhere for naming tidiness would split one story
  // across two audiences.
  data_change_request: "hr",
  data_change_policy: "hr",
  service_request: "hr",
  service_request_type: "hr",
  request_approval_stage: "hr",
  // WS-14 (§30.23). "hr" for the same reason every people-process prefix above
  // is: an HR auditor holding OD #17's category-scoped `audit.read.hr` must be
  // able to see capability decisions and succession decisions together. The
  // sensitivity of succession is enforced by its own permission and by the
  // sensitive-read path, not by hiding its trail from HR.
  skill: "hr",
  proficiency_scale: "hr",
  employee_skill_record: "hr",
  position_skill_requirement: "hr",
  readiness_level: "hr",
  succession_plan: "hr",
  succession_candidate: "hr",
  development_action: "hr",
  employee_number: "hr",
  employee_qualification: "hr",
  employee_skill: "hr",
  application: "hr",
  internal_application: "hr",
  background_check: "hr",
  candidate_note: "hr",
  candidate_tag: "hr",
  interview: "hr",
  job_requisition: "hr",
  offer: "hr",
  offer_version: "hr",
  learning_certificate: "hr",
  learning_course: "hr",
  learning_course_session: "hr",
  learning_enrollment: "hr",
  leave_balance: "hr",
  leave_request: "hr",
  performance_cycle: "hr",
  performance_review: "hr",
  performance_review_goal: "hr",
  pre_employment_requirement: "hr",
  reference_check: "hr",
  talent_pool: "hr",
  vacancy: "hr",
};

/** All six categories, in a stable order — used to seed permission checks and UI filters. */
export const AUDIT_CATEGORIES: readonly AuditCategory[] = [
  "hr",
  "payroll",
  "security",
  "documents",
  "assets_inventory",
  "platform_configuration",
];

/** Resolves an event_type's category from its prefix (text before the first "."). Fail-closed default: "security". */
export function resolveAuditCategory(eventType: string): AuditCategory {
  const prefix = eventType.split(".")[0];
  return CATEGORY_BY_PREFIX[prefix] ?? "security";
}
