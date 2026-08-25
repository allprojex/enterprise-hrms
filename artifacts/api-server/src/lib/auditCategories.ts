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
  // WS-4 (Break-Glass Access Foundation, Owner Decision #31): every grant
  // lifecycle event (activated/revoked) is security-category by nature —
  // this is the one prefix the pre-existing fail-closed default already
  // anticipated (see this file's own comment history), registered
  // explicitly here for clarity rather than left to fall through.
  break_glass_grant: "security",

  // --- payroll ---
  payroll_banking: "payroll",
  payroll_compensation: "payroll",
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
  // WS-4 (Installation Registry, Owner Decision #29): deployment/runtime
  // identity administration — platform-scoped, never HR content.
  installation: "platform_configuration",
  module: "platform_configuration",
  master_data_item: "platform_configuration",
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
