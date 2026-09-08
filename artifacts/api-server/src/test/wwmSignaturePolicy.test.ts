/**
 * WS-26C — WWM signature policies (WS-26B).
 *
 * Leave and PIF carry a validated per-slot signature policy bound to their real
 * signature items; Evaluation and Probationary Assessment have NO signature
 * items and NO policy (their signatures live on the appended Signature &
 * Approval Certificate). Nothing here auto-applies a signature.
 */
import { describe, it, expect } from "vitest";
import { WWM_FORM_TEMPLATES } from "../formTemplates/wwm";
import { validateSignaturePolicy } from "../lib/formEngine/templates";
import type { FormDefinition, FormItem } from "../lib/formEngine/definition";

function signatureItemKeys(def: FormDefinition): { key: string; role: string }[] {
  const out: { key: string; role: string }[] = [];
  for (const s of def.sections) for (const it of s.items as FormItem[]) if (it.kind === "signature") out.push({ key: it.key, role: it.role });
  return out;
}
const seed = (formType: string) => WWM_FORM_TEMPLATES.find((t) => t.formType === formType)!;

describe("WWM signature policies", () => {
  it("Leave Application: employee + approver slots, validated against the definition", () => {
    const s = seed("leave_application");
    expect(s.signaturePolicy).toBeDefined();
    const policy = validateSignaturePolicy(s.definition, s.signaturePolicy);
    expect(policy).not.toBeNull();
    expect(policy!.slots.map((x) => x.key).sort()).toEqual(["approver_signature", "employee_signature"]);
    const byKey = Object.fromEntries(policy!.slots.map((x) => [x.key, x]));
    expect(byKey.employee_signature.role).toBe("employee");
    expect(byKey.approver_signature.role).toBe("supervisor");
    for (const slot of policy!.slots) expect(slot.methods).toEqual(["drawn", "uploaded", "device"]);
    // Every policy slot is a real signature item in the source definition.
    const items = signatureItemKeys(s.definition).map((i) => i.key).sort();
    expect(items).toEqual(["approver_signature", "employee_signature"]);
  });

  it("PIF: single employee signature slot, validated", () => {
    const s = seed("personal_information");
    expect(s.signaturePolicy).toBeDefined();
    const policy = validateSignaturePolicy(s.definition, s.signaturePolicy)!;
    expect(policy.slots.map((x) => x.key)).toEqual(["employee_signature"]);
    expect(policy.slots[0].role).toBe("employee");
    expect(signatureItemKeys(s.definition).map((i) => i.key)).toEqual(["employee_signature"]);
  });

  it("Staff Evaluation: certificate-only — no signature items, no policy", () => {
    const s = seed("staff_evaluation");
    expect(s.signaturePolicy).toBeUndefined();
    expect(signatureItemKeys(s.definition)).toEqual([]);
  });

  it("Probationary Assessment: certificate-only — no signature items, no policy", () => {
    const s = seed("probationary_assessment");
    expect(s.signaturePolicy).toBeUndefined();
    expect(signatureItemKeys(s.definition)).toEqual([]);
  });
});
