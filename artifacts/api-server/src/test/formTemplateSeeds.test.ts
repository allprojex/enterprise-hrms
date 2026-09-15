/**
 * The cross-tenant form template seed catalogue (S3).
 *
 * One governed operator entry point serves every tenant, so the catalogue it
 * reads is now a platform-level registry rather than one organization's list.
 * That is only safe while two things hold, and both are asserted here:
 *
 *   - the catalogue still carries exactly the seeds each tenant module owns, so
 *     generalising the script changed no organization's behaviour;
 *   - template keys are unique across the whole catalogue, because the engine
 *     resolves a seed BY KEY within the target organization. Two tenants
 *     sharing a key would let one organization's seed match another's template.
 */
import { describe, it, expect } from "vitest";
import { FORM_TEMPLATE_SEEDS } from "../formTemplates";
import { WWM_FORM_TEMPLATES } from "../formTemplates/wwm";

describe("FORM_TEMPLATE_SEEDS", () => {
  it("carries every WWM seed, unchanged", () => {
    for (const seed of WWM_FORM_TEMPLATES) {
      expect(FORM_TEMPLATE_SEEDS).toContain(seed);
    }
  });

  it("adds nothing WWM does not own (today WWM is the only tenant with seeds)", () => {
    expect(FORM_TEMPLATE_SEEDS).toHaveLength(WWM_FORM_TEMPLATES.length);
  });

  it("has no duplicate template key across tenants", () => {
    const keys = FORM_TEMPLATE_SEEDS.map((s) => s.templateKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("namespaces every key, so a future tenant cannot collide by accident", () => {
    for (const seed of FORM_TEMPLATE_SEEDS) {
      expect(seed.templateKey).toMatch(/^[a-z0-9]+_[a-z0-9_]+$/);
    }
  });
});
