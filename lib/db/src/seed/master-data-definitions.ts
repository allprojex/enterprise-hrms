/**
 * Master Data domain registry, per ARCHITECTURE.md/DECISIONS.md's ADR-010.
 * Fixed, code-owned classification (not DB-driven — mirrors
 * MODULE_DEFINITIONS in module-definitions.ts). "system-defined" domains
 * never accept organization-added rows; "organization-overridable" and
 * "organization-defined" domains do, enforced in
 * artifacts/api-server/src/lib/masterData.ts.
 */

export type MasterDataClassification = "system-defined" | "organization-overridable" | "organization-defined";

export interface MasterDataDomainDefinition {
  key: string;
  label: string;
  classification: MasterDataClassification;
}

export const MASTER_DATA_DOMAINS: readonly MasterDataDomainDefinition[] = [
  { key: "title", label: "Title", classification: "organization-overridable" },
  { key: "gender", label: "Gender", classification: "system-defined" },
  { key: "marital_status", label: "Marital Status", classification: "system-defined" },
  { key: "country", label: "Country", classification: "system-defined" },
  { key: "region", label: "Region", classification: "organization-defined" },
  { key: "city", label: "City", classification: "organization-defined" },
  { key: "nationality", label: "Nationality", classification: "system-defined" },
  { key: "language", label: "Language", classification: "system-defined" },
  { key: "education_level", label: "Education Level", classification: "organization-overridable" },
  { key: "employment_type", label: "Employment Type", classification: "organization-overridable" },
  { key: "worker_classification", label: "Worker Classification", classification: "organization-overridable" },
  { key: "employment_status", label: "Employment Status", classification: "organization-overridable" },
  { key: "skill", label: "Skill", classification: "organization-defined" },
  { key: "qualification_type", label: "Qualification Type", classification: "organization-overridable" },
  { key: "certification_type", label: "Certification Type", classification: "organization-defined" },
  { key: "professional_membership", label: "Professional Membership", classification: "organization-defined" },
  { key: "document_category", label: "Document Category", classification: "organization-defined" },
  { key: "asset_category", label: "Asset Category", classification: "organization-defined" },
  { key: "request_type", label: "Request Type", classification: "organization-defined" },
  { key: "separation_reason", label: "Separation Reason", classification: "organization-overridable" },
  // Phase 3D, W85 — Learning Foundation. Course categories reuse this
  // existing mechanism rather than a dedicated learning_categories table
  // (docs/PHASE_3D_LEARNING_IMPLEMENTATION_PLAN.md §8.6, Owner Decision 7) —
  // same shape/precedent as document_category. No default items are frozen
  // for this domain; only the domain itself is registered here.
  { key: "training_category", label: "Training Category", classification: "organization-defined" },
] as const;

/** Throws on: duplicate domain keys. Called before every seed insert. */
export function validateMasterDataDomains(domains: readonly MasterDataDomainDefinition[]): void {
  const seen = new Set<string>();
  for (const domain of domains) {
    if (seen.has(domain.key)) {
      throw new Error(`Duplicate master data domain key "${domain.key}" in MASTER_DATA_DOMAINS.`);
    }
    seen.add(domain.key);
  }
}

export function isKnownMasterDataDomain(key: string): boolean {
  return MASTER_DATA_DOMAINS.some((d) => d.key === key);
}

export function getMasterDataDomain(key: string): MasterDataDomainDefinition | undefined {
  return MASTER_DATA_DOMAINS.find((d) => d.key === key);
}
