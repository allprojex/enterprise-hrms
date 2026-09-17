/**
 * WS-3 (Audit & Sensitive-Data Security Hardening) — pure unit tests for
 * the two shared primitives this workstream introduced: audit-category
 * resolution (Owner Decision #17) and sensitive-value masking (Owner
 * Decision #23). No @workspace/db mocking needed — these are plain
 * functions with no I/O.
 */
import { describe, it, expect } from "vitest";
import { resolveAuditCategory, AUDIT_CATEGORIES } from "../lib/auditCategories";
import { maskAccountNumber, maskIdentifier } from "../lib/sensitiveData";

describe("resolveAuditCategory", () => {
  it("resolves known HR-prefixed event types", () => {
    expect(resolveAuditCategory("employee.separated")).toBe("hr");
    expect(resolveAuditCategory("job_requisition.created")).toBe("hr");
    expect(resolveAuditCategory("offer.approved")).toBe("hr");
  });

  it("resolves known Payroll-prefixed event types", () => {
    expect(resolveAuditCategory("payroll_banking.read")).toBe("payroll");
    expect(resolveAuditCategory("payroll_run.locked")).toBe("payroll");
  });

  it("resolves known Security-prefixed event types", () => {
    expect(resolveAuditCategory("session.org_switch")).toBe("security");
    expect(resolveAuditCategory("platform_user.disabled")).toBe("security");
    expect(resolveAuditCategory("role.copied_from_template")).toBe("security");
  });

  it("resolves known Documents-prefixed event types", () => {
    expect(resolveAuditCategory("personnel_file.viewed")).toBe("documents");
    expect(resolveAuditCategory("employee_document.uploaded")).toBe("documents");
  });

  it("resolves known Assets/Inventory-prefixed event types", () => {
    expect(resolveAuditCategory("asset.assigned")).toBe("assets_inventory");
    expect(resolveAuditCategory("office_inventory_item.created")).toBe("assets_inventory");
  });

  it("resolves known Platform-Configuration-prefixed event types", () => {
    expect(resolveAuditCategory("organization.updated")).toBe("platform_configuration");
    expect(resolveAuditCategory("module.enabled")).toBe("platform_configuration");
  });

  it("files WS-26 form events under HR/documents instead of the fail-closed security default", () => {
    for (const event of ["form.created", "form.approved", "form.returned", "form.rejected", "form.finalized", "form.signature_applied", "form.downloaded"]) {
      expect(resolveAuditCategory(event)).toBe("hr");
    }
    for (const event of ["form_template.created", "form_template.version_published", "form_template.activation_run"]) {
      expect(resolveAuditCategory(event)).toBe("documents");
    }
    expect(resolveAuditCategory("signature_asset.uploaded")).toBe("documents");
    expect(resolveAuditCategory("signature_asset.revoked")).toBe("documents");
  });

  it("files account-profile and profile-picture changes", () => {
    expect(resolveAuditCategory("user.profile_updated")).toBe("security");
    expect(resolveAuditCategory("employee.profile_picture_updated")).toBe("hr");
    expect(resolveAuditCategory("employee.profile_picture_removed")).toBe("hr");
  });

  it("fails closed to 'security' for an unrecognized/future prefix", () => {
    expect(resolveAuditCategory("some_brand_new_event_type.created")).toBe("security");
    expect(resolveAuditCategory("support_access.granted")).toBe("security");
  });

  it("every category in the resolver's own vocabulary is a member of AUDIT_CATEGORIES", () => {
    for (const category of ["hr", "payroll", "security", "documents", "assets_inventory", "platform_configuration"] as const) {
      expect(AUDIT_CATEGORIES).toContain(category);
    }
    expect(AUDIT_CATEGORIES).toHaveLength(6);
  });
});

describe("maskAccountNumber / maskIdentifier", () => {
  it("masks all but the last 4 characters of a long value", () => {
    expect(maskAccountNumber("1234567890123")).toBe("*********0123");
  });

  it("masks a value of exactly 4 characters entirely (no characters to safely reveal)", () => {
    expect(maskAccountNumber("1234")).toBe("****");
  });

  it("masks a value shorter than 4 characters entirely", () => {
    expect(maskAccountNumber("12")).toBe("**");
  });

  it("maskIdentifier behaves identically for a SSNIT-shaped value", () => {
    expect(maskIdentifier("SN123456789")).toBe("*******6789");
  });

  it("maskIdentifier behaves identically for a TIN-shaped value", () => {
    expect(maskIdentifier("C0012345678")).toBe("*******5678");
  });
});
