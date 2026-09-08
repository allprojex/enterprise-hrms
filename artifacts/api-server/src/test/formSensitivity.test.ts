/**
 * WS-26C — generic field-level sensitivity (pure logic).
 *
 * Proves the redaction rule the engine enforces before any DB/HTTP: sensitive
 * field VALUES are visible only to the subject employee (resolved server-side,
 * never a client-supplied id) or a caller holding the field's read permission;
 * everyone else gets the value blanked with the key/structure preserved.
 */
import { describe, it, expect } from "vitest";
import {
  sensitiveFieldRequirements,
  redactedSensitiveKeys,
  redactValues,
  DEFAULT_SENSITIVE_READ_PERMISSION,
} from "../lib/formEngine/sensitivity";
import { validateFormDefinition, type FormDefinition } from "../lib/formEngine/definition";

const def: FormDefinition = validateFormDefinition({
  header: { lines: ["Org"], logo: "none" },
  sections: [
    {
      key: "main",
      title: "Main",
      layout: "key_value",
      items: [
        { kind: "field", key: "full_name", label: "Full Name", type: "short_text" },
        { kind: "field", key: "ghana_card", label: "Ghana Card No.", type: "short_text", sensitive: true },
        { kind: "field", key: "medical", label: "Medical", type: "long_text", sensitive: true, readPermission: "employee.medical.read" },
      ],
    },
  ],
});

describe("form field sensitivity — requirements", () => {
  it("collects sensitive fields with their read permission (defaulting to employee.sensitive.read)", () => {
    const req = sensitiveFieldRequirements(def);
    expect(req.get("ghana_card")).toBe(DEFAULT_SENSITIVE_READ_PERMISSION);
    expect(req.get("medical")).toBe("employee.medical.read");
    expect(req.has("full_name")).toBe(false);
  });
});

describe("form field sensitivity — per-viewer redaction", () => {
  const subjectEmployeeId = 42;

  it("the subject employee (server-resolved id) sees all of their own sensitive values", () => {
    const keys = redactedSensitiveKeys(def, { employeeId: 42, permissions: new Set() }, subjectEmployeeId);
    expect(keys.size).toBe(0);
  });

  it("a different employee without the read permission has every sensitive value redacted", () => {
    const keys = redactedSensitiveKeys(def, { employeeId: 99, permissions: new Set(["form.read"]) }, subjectEmployeeId);
    expect([...keys].sort()).toEqual(["ghana_card", "medical"]);
  });

  it("a caller holding a field's read permission sees that field but not others", () => {
    const keys = redactedSensitiveKeys(def, { employeeId: 99, permissions: new Set([DEFAULT_SENSITIVE_READ_PERMISSION]) }, subjectEmployeeId);
    expect([...keys]).toEqual(["medical"]); // has employee.sensitive.read (unlocks ghana_card) but not employee.medical.read
  });

  it("an unlinked caller (employeeId null) is never treated as the subject", () => {
    const keys = redactedSensitiveKeys(def, { employeeId: null, permissions: new Set() }, subjectEmployeeId);
    expect(keys.size).toBe(2);
  });

  it("a client cannot spoof self: redaction is keyed on the passed (server-resolved) employeeId only", () => {
    // Even if a colleague's id equals some other number, only an exact match to the subject clears redaction.
    const keys = redactedSensitiveKeys(def, { employeeId: 43, permissions: new Set() }, subjectEmployeeId);
    expect(keys.size).toBe(2);
  });
});

describe("form field sensitivity — redactValues", () => {
  it("blanks only the named keys, preserving structure, and copies (no mutation)", () => {
    const values = { full_name: "Kofi Asante", ghana_card: "GHA-123", medical: "n/a" };
    const out = redactValues(values, new Set(["ghana_card", "medical"]));
    expect(out).toEqual({ full_name: "Kofi Asante", ghana_card: null, medical: null });
    expect(values.ghana_card).toBe("GHA-123"); // original unchanged
  });

  it("is a no-op when nothing is redacted", () => {
    const values = { a: 1 };
    expect(redactValues(values, new Set())).toBe(values);
  });
});
