/**
 * Employee backend hardening, Phase 1 (2026-10-08) — pure rules in
 * lib/employeeRecordPolicy.ts: the sensitive-write field set, the generic
 * update's status matrix, format and date-consistency validation on the
 * merged record, and the masked audit summaries. No database.
 */
import { describe, it, expect } from "vitest";
import {
  SENSITIVE_EMPLOYEE_WRITE_FIELDS,
  ADMINISTRATIVE_EMPLOYMENT_STATUSES,
  partitionEmployeeWrite,
  assertEmployeeWriteAuthorized,
  omitUnauthorizedSensitiveFields,
  assertStatusChangeAllowedViaUpdate,
  assertInitialStatusAllowed,
  validateEmployeeFieldFormats,
  validateEmployeeDateConsistency,
  isValidEmailAddress,
  isValidPhoneNumber,
  maskEmployeeAuditValue,
  summarizeEmployeeChanges,
  summarizeEmployeeCreation,
  EmployeeSensitiveWriteForbiddenError,
  EmployeeStatusChangeNotAllowedError,
  EmployeeValidationError,
} from "../lib/employeeRecordPolicy";

const FULL = { canWriteSensitive: true, canWriteNotes: true };
const GENERAL = { canWriteSensitive: false, canWriteNotes: false };

describe("sensitive-write field set", () => {
  it("mirrors the read-side redaction set, field for field", () => {
    expect([...SENSITIVE_EMPLOYEE_WRITE_FIELDS].sort()).toEqual(
      [
        "alternatePhoneNumber",
        "dateOfBirth",
        "emergencyContacts",
        "gender",
        "maritalStatus",
        "nationalId",
        "nationality",
        "passportNumber",
        "personalEmail",
        "phoneNumber",
        "residentialAddress",
      ].sort(),
    );
  });

  it("keeps names, placement and employment fields on the general grant", () => {
    const { sensitiveFields, writesNotes } = partitionEmployeeWrite({
      firstName: "A",
      lastName: "B",
      workEmail: "a@b.co",
      departmentId: 1,
      positionId: 2,
      branchId: 3,
      reportingManagerId: 4,
      hireDate: new Date(),
      employmentType: "full_time",
      workLocation: "HQ",
      employmentStatus: "active",
    });
    expect(sensitiveFields).toEqual([]);
    expect(writesNotes).toBe(false);
  });

  it("treats clearing a STORED value as a write, null-on-null and undefined as no write", () => {
    expect(partitionEmployeeWrite({ nationalId: null }, { nationalId: "GHA-1" }).sensitiveFields).toEqual(["nationalId"]);
    expect(partitionEmployeeWrite({ nationalId: null }, { nationalId: null }).sensitiveFields).toEqual([]);
    expect(partitionEmployeeWrite({ nationalId: null }).sensitiveFields).toEqual([]);
    expect(partitionEmployeeWrite({ nationalId: undefined }).sensitiveFields).toEqual([]);
  });

  it("refuses a mixed body as a whole when any sensitive field is present without the key", () => {
    expect(() => assertEmployeeWriteAuthorized({ firstName: "Ok", phoneNumber: "+233200000000" }, GENERAL)).toThrow(
      EmployeeSensitiveWriteForbiddenError,
    );
    try {
      assertEmployeeWriteAuthorized({ firstName: "Ok", phoneNumber: "+233200000000", nationalId: "X" }, GENERAL);
    } catch (err) {
      const e = err as EmployeeSensitiveWriteForbiddenError;
      expect(e.fields).toEqual(["phoneNumber", "nationalId"]);
      expect(e.requiredPermission).toBe("employee.sensitive.write");
      // The message names fields, never the values being written.
      expect(e.message).not.toContain("+233200000000");
      expect(e.message).not.toContain("X\"");
    }
  });

  it("gates notes on the notes permission, independently of the sensitive key", () => {
    expect(() => assertEmployeeWriteAuthorized({ notes: "x" }, { canWriteSensitive: true, canWriteNotes: false })).toThrow(
      /employee\.notes\.read/,
    );
    expect(() => assertEmployeeWriteAuthorized({ notes: "x" }, { canWriteSensitive: false, canWriteNotes: true })).not.toThrow();
  });

  it("passes a sensitive write when the key is held", () => {
    expect(() => assertEmployeeWriteAuthorized({ nationalId: "GHA-1", notes: "n" }, FULL)).not.toThrow();
  });
});

describe("unchanged sensitive values are not writes (decided against the persisted row)", () => {
  const stored = {
    phoneNumber: "+233200000001",
    nationalId: "GHA-000000000-1",
    personalEmail: null,
    dateOfBirth: new Date("1990-05-04T00:00:00.000Z"),
    residentialAddress: { line1: "12 Liberation Rd", city: "Accra" },
    emergencyContacts: [{ name: "A", relationship: "Spouse", phone: "+233241112222" }],
    notes: "private",
  };

  it("re-sending the stored values alongside a general edit needs no key", () => {
    const body = { lastName: "Darko", phoneNumber: "+233200000001", nationalId: "GHA-000000000-1", notes: "private" };
    expect(partitionEmployeeWrite(body, stored)).toEqual({ sensitiveFields: [], writesNotes: false });
    expect(() => assertEmployeeWriteAuthorized(body, GENERAL, stored)).not.toThrow();
  });

  it("treats null, blank and whitespace as the same absence, and trims strings", () => {
    expect(partitionEmployeeWrite({ personalEmail: null }, stored).sensitiveFields).toEqual([]);
    expect(partitionEmployeeWrite({ personalEmail: "" }, stored).sensitiveFields).toEqual([]);
    expect(partitionEmployeeWrite({ personalEmail: "   " }, stored).sensitiveFields).toEqual([]);
    expect(partitionEmployeeWrite({ phoneNumber: "  +233200000001 " }, stored).sensitiveFields).toEqual([]);
  });

  it("compares dates by instant and json by value", () => {
    expect(partitionEmployeeWrite({ dateOfBirth: new Date("1990-05-04T00:00:00.000Z") }, stored).sensitiveFields).toEqual([]);
    expect(partitionEmployeeWrite({ residentialAddress: { line1: "12 Liberation Rd", city: "Accra" } }, stored).sensitiveFields).toEqual([]);
    expect(partitionEmployeeWrite({ emergencyContacts: [{ name: "A", relationship: "Spouse", phone: "+233241112222" }] }, stored).sensitiveFields).toEqual([]);
    expect(partitionEmployeeWrite({ dateOfBirth: new Date("1990-05-05T00:00:00.000Z") }, stored).sensitiveFields).toEqual(["dateOfBirth"]);
    expect(partitionEmployeeWrite({ residentialAddress: { line1: "12 Liberation Rd", city: "Kumasi" } }, stored).sensitiveFields).toEqual(["residentialAddress"]);
  });

  it("clearing a stored value and setting an absent one are both writes", () => {
    expect(partitionEmployeeWrite({ phoneNumber: null }, stored).sensitiveFields).toEqual(["phoneNumber"]);
    expect(partitionEmployeeWrite({ personalEmail: "k@example.test" }, stored).sensitiveFields).toEqual(["personalEmail"]);
    expect(partitionEmployeeWrite({ notes: null }, stored).writesNotes).toBe(true);
    expect(partitionEmployeeWrite({ notes: "changed" }, stored).writesNotes).toBe(true);
  });

  it("a mixed body with one real sensitive change is still refused whole, naming only the changed field", () => {
    const body = { lastName: "Darko", phoneNumber: "+233200000001", nationalId: "GHA-CHANGED" };
    expect(() => assertEmployeeWriteAuthorized(body, GENERAL, stored)).toThrow(EmployeeSensitiveWriteForbiddenError);
    try {
      assertEmployeeWriteAuthorized(body, GENERAL, stored);
    } catch (err) {
      expect((err as EmployeeSensitiveWriteForbiddenError).fields).toEqual(["nationalId"]);
    }
  });

  it("without a persisted row (creation) only non-null sensitive values count", () => {
    expect(partitionEmployeeWrite({ phoneNumber: null, nationalId: "X" }, null).sensitiveFields).toEqual(["nationalId"]);
  });

  it("omitUnauthorizedSensitiveFields drops only the sensitive non-null fields and names them", () => {
    const { fields, omitted } = omitUnauthorizedSensitiveFields(
      { firstName: "Jane", lastName: "Doe", personalEmail: "j@example.test", phoneNumber: null, nationality: "Ghanaian", departmentId: 3 },
      GENERAL,
    );
    expect(omitted.sort()).toEqual(["nationality", "personalEmail"]);
    expect(fields).toEqual({ firstName: "Jane", lastName: "Doe", phoneNumber: null, departmentId: 3 });
    const full = omitUnauthorizedSensitiveFields({ firstName: "Jane", personalEmail: "j@example.test" }, FULL);
    expect(full.omitted).toEqual([]);
    expect(full.fields.personalEmail).toBe("j@example.test");
  });
});

describe("generic-update status matrix", () => {
  it("allows the administrative states to move among themselves", () => {
    for (const from of ADMINISTRATIVE_EMPLOYMENT_STATUSES) {
      for (const to of ADMINISTRATIVE_EMPLOYMENT_STATUSES) {
        if (from === "probation" && to === "active") continue;
        expect(() => assertStatusChangeAllowedViaUpdate(from, to), `${from} -> ${to}`).not.toThrow();
      }
    }
  });

  it("treats an unchanged or absent status as a no-op, including for separated employees", () => {
    expect(() => assertStatusChangeAllowedViaUpdate("terminated", "terminated")).not.toThrow();
    expect(() => assertStatusChangeAllowedViaUpdate("terminated", undefined)).not.toThrow();
  });

  it("refuses termination and points at the separation action", () => {
    for (const from of ADMINISTRATIVE_EMPLOYMENT_STATUSES) {
      expect(() => assertStatusChangeAllowedViaUpdate(from, "terminated")).toThrow(/separation action/);
    }
  });

  it("refuses reactivating a separated employee and points at rehire", () => {
    for (const to of ADMINISTRATIVE_EMPLOYMENT_STATUSES) {
      expect(() => assertStatusChangeAllowedViaUpdate("terminated", to)).toThrow(/rehire action/);
    }
  });

  it("refuses probation -> active and points at confirmation", () => {
    expect(() => assertStatusChangeAllowedViaUpdate("probation", "active")).toThrow(/confirmation action/);
    expect(() => assertStatusChangeAllowedViaUpdate("probation", "active")).toThrow(EmployeeStatusChangeNotAllowedError);
  });

  it("never lets a record be created already separated", () => {
    expect(() => assertInitialStatusAllowed("terminated")).toThrow(EmployeeStatusChangeNotAllowedError);
    expect(() => assertInitialStatusAllowed("probation")).not.toThrow();
    expect(() => assertInitialStatusAllowed(undefined)).not.toThrow();
  });
});

describe("field formats", () => {
  it("accepts ordinary addresses and rejects plainly malformed ones", () => {
    expect(isValidEmailAddress("ama.mensah@example.org")).toBe(true);
    expect(isValidEmailAddress("not-an-email")).toBe(false);
    expect(isValidEmailAddress("two words@example.org")).toBe(false);
    expect(isValidEmailAddress("a@b")).toBe(false);
  });

  it("accepts Ghanaian local and international phone forms and rejects letters", () => {
    expect(isValidPhoneNumber("0244123456")).toBe(true);
    expect(isValidPhoneNumber("+233 24 412 3456")).toBe(true);
    expect(isValidPhoneNumber("+233-(0)24-4123456")).toBe(true);
    expect(isValidPhoneNumber("abc")).toBe(false);
    expect(isValidPhoneNumber("+1")).toBe(false);
    expect(isValidPhoneNumber("( ) - -")).toBe(false);
  });

  it("validates only the fields supplied, so a legacy value elsewhere never blocks an unrelated edit", () => {
    expect(() => validateEmployeeFieldFormats({ workEmail: "nope" })).toThrow(EmployeeValidationError);
    expect(() => validateEmployeeFieldFormats({ phoneNumber: "abc" })).toThrow(/Phone number/);
    expect(() => validateEmployeeFieldFormats({ alternatePhoneNumber: "abc" })).toThrow(/Alternative phone/);
    expect(() => validateEmployeeFieldFormats({ workEmail: null, personalEmail: "", phoneNumber: "   " })).not.toThrow();
  });
});

describe("date consistency on the merged record", () => {
  const now = new Date("2026-10-08T12:00:00Z");

  it("rejects a future date of birth, including by timezone-safe day comparison", () => {
    expect(() => validateEmployeeDateConsistency({ dateOfBirth: new Date("2026-10-09T00:00:00Z") }, now)).toThrow(/future/);
    expect(() => validateEmployeeDateConsistency({ dateOfBirth: new Date("2026-10-08T23:59:00Z") }, now)).not.toThrow();
  });

  it("rejects hire before birth, probation end before hire, separation before hire", () => {
    expect(() => validateEmployeeDateConsistency({ dateOfBirth: new Date("2000-01-01"), hireDate: new Date("1999-12-31") }, now)).toThrow(/Hire date/);
    expect(() => validateEmployeeDateConsistency({ hireDate: new Date("2026-01-15"), probationEndDate: new Date("2025-12-31") }, now)).toThrow(/Probation end/);
    expect(() => validateEmployeeDateConsistency({ hireDate: new Date("2026-01-15"), separationDate: new Date("2020-01-01") }, now)).toThrow(/Separation date/);
  });

  it("accepts a consistent record and ignores absent dates", () => {
    expect(() =>
      validateEmployeeDateConsistency(
        { dateOfBirth: new Date("1990-05-04"), hireDate: new Date("2026-01-15"), probationEndDate: new Date("2026-07-15"), separationDate: null },
        now,
      ),
    ).not.toThrow();
    expect(() => validateEmployeeDateConsistency({}, now)).not.toThrow();
  });

  it("rejects an invalid Date object rather than comparing NaN", () => {
    expect(() => validateEmployeeDateConsistency({ hireDate: new Date("nonsense") }, now)).toThrow(/not a valid date/);
  });
});

describe("audit shaping", () => {
  it("masks sensitive string values to their last four characters and objects entirely", () => {
    expect(maskEmployeeAuditValue("nationalId", "GHA-123456789-0")).toBe("***********89-0");
    expect(maskEmployeeAuditValue("residentialAddress", { line1: "12 Liberation Rd" })).toBe("***");
    expect(maskEmployeeAuditValue("notes", "private")).toBe("***vate");
    expect(maskEmployeeAuditValue("nationalId", null)).toBeNull();
  });

  it("leaves non-sensitive values readable", () => {
    expect(maskEmployeeAuditValue("firstName", "Ama")).toBe("Ama");
    expect(maskEmployeeAuditValue("departmentId", 7)).toBe(7);
  });

  it("summarizes only the fields that actually changed, with masked sensitive values", () => {
    const before = { firstName: "Ama", lastName: "Mensah", nationalId: "GHA-OLD-0001", departmentId: 1, updatedAt: new Date(1) };
    const after = { firstName: "Ama", lastName: "Darko", nationalId: "GHA-NEW-0002", departmentId: 1, updatedAt: new Date(2) };
    const summary = summarizeEmployeeChanges(before, after, ["firstName", "lastName", "nationalId", "departmentId", "updatedAt"]);
    expect(summary.changedFields).toEqual(["lastName", "nationalId"]);
    expect(summary.beforeState).toEqual({ lastName: "Mensah", nationalId: "********0001" });
    expect(summary.afterState).toEqual({ lastName: "Darko", nationalId: "********0002" });
    expect(JSON.stringify(summary)).not.toContain("GHA-NEW");
  });

  it("compares dates and json by value, not identity", () => {
    const d = "2026-01-15T00:00:00.000Z";
    const summary = summarizeEmployeeChanges(
      { hireDate: new Date(d), residentialAddress: { city: "Accra" } },
      { hireDate: new Date(d), residentialAddress: { city: "Accra" } },
      ["hireDate", "residentialAddress"],
    );
    expect(summary.changedFields).toEqual([]);
  });

  it("records the names of fields set on creation and masks their sensitive values", () => {
    const creation = summarizeEmployeeCreation({ firstName: "Kwame", nationalId: "GHA-123456789-0", notes: null, personalEmail: "k@example.test" });
    expect(creation.setFields).toEqual(["firstName", "nationalId", "personalEmail"]);
    expect(creation.afterState.firstName).toBe("Kwame");
    expect(creation.afterState.nationalId).toBe("***********89-0");
    expect(JSON.stringify(creation)).not.toContain("k@example.test");
  });
});
