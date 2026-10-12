/**
 * Employee form contract (Phase 2 — Employee Administration UI).
 *
 * Pure-function coverage for the form ⇄ API mapping in
 * src/components/employees/employee-form-schema.ts: validation mirrors the
 * server's format and date rules, the create body omits what was not entered,
 * and the update body is a diff that never echoes an unchanged or redacted
 * sensitive value.
 */
import { describe, it, expect } from 'vitest';
import type { Employee } from '@workspace/api-client-react';
import {
  EMPTY_EMPLOYEE_FORM,
  buildUpdatePatch,
  employeeFormSchema,
  employeeToFormValues,
  formatDateOnly,
  toCreatePayload,
  toDateOnly,
  type EmployeeFormValues,
} from '@/components/employees/employee-form-schema';

const now = '2026-10-01T00:00:00.000Z';

function storedEmployee(overrides: Partial<Employee> = {}): Employee {
  return {
    id: 42,
    organizationId: 10,
    employeeNumber: 'EMP-0042',
    firstName: 'Ada',
    lastName: 'Lovelace',
    middleName: null,
    preferredName: null,
    gender: 'female',
    dateOfBirth: '1990-12-10T00:00:00.000Z',
    maritalStatus: null,
    nationality: 'Ghanaian',
    nationalId: 'GHA-123',
    passportNumber: null,
    personalEmail: 'ada@example.com',
    workEmail: 'ada@wwm.example',
    phoneNumber: '+233 20 000 0000',
    alternatePhoneNumber: null,
    residentialAddress: { line1: '1 Analytical St', city: 'Accra', state: 'Greater Accra', country: 'Ghana' },
    emergencyContacts: [{ name: 'Charles', relationship: 'Spouse', phone: '+233200000001' }],
    departmentId: 3,
    departmentName: 'Engineering',
    branchId: null,
    positionId: 7,
    positionName: 'Analyst',
    reportingManagerId: 9,
    reportingManagerName: 'Grace Hopper',
    employmentType: 'full_time',
    hireDate: '2024-01-15T00:00:00.000Z',
    probationEndDate: '2024-07-15T00:00:00.000Z',
    employmentStatus: 'active',
    workLocation: 'Head office',
    notes: 'Internal note',
    sensitiveFieldsRedacted: false,
    linkedApplicationUserId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

const fullAccess = { includeSensitive: true, includeNotes: true, includeEmployeeNumber: true };

describe('employeeFormSchema — validation mirrors the server', () => {
  it('requires first and last name and nothing else', () => {
    const minimal = employeeFormSchema.safeParse({ ...EMPTY_EMPLOYEE_FORM, firstName: 'Ada', lastName: 'Lovelace' });
    expect(minimal.success).toBe(true);

    const missing = employeeFormSchema.safeParse({ ...EMPTY_EMPLOYEE_FORM, firstName: ' ', lastName: '' });
    expect(missing.success).toBe(false);
    const paths = missing.success ? [] : missing.error.issues.map((i) => i.path.join('.'));
    expect(paths).toContain('firstName');
    expect(paths).toContain('lastName');
  });

  it('rejects malformed emails and phones but accepts blanks', () => {
    const bad = employeeFormSchema.safeParse({
      ...EMPTY_EMPLOYEE_FORM,
      firstName: 'A',
      lastName: 'B',
      workEmail: 'not-an-email',
      phoneNumber: '12',
    });
    expect(bad.success).toBe(false);
    const paths = bad.success ? [] : bad.error.issues.map((i) => i.path.join('.'));
    expect(paths).toEqual(expect.arrayContaining(['workEmail', 'phoneNumber']));

    const blank = employeeFormSchema.safeParse({ ...EMPTY_EMPLOYEE_FORM, firstName: 'A', lastName: 'B', workEmail: '', phoneNumber: '' });
    expect(blank.success).toBe(true);
  });

  it('enforces the server date rules: no future birth, hire ≥ birth, probation ≥ hire', () => {
    const future = new Date(Date.now() + 86_400_000 * 2).toISOString().slice(0, 10);
    const r = employeeFormSchema.safeParse({
      ...EMPTY_EMPLOYEE_FORM,
      firstName: 'A',
      lastName: 'B',
      dateOfBirth: future,
      hireDate: '2000-01-01',
      probationEndDate: '1999-12-31',
    });
    expect(r.success).toBe(false);
    const byPath = Object.fromEntries((r.success ? [] : r.error.issues).map((i) => [i.path.join('.'), i.message]));
    expect(byPath.dateOfBirth).toMatch(/future/);
    expect(byPath.hireDate).toMatch(/before the date of birth/);
    expect(byPath.probationEndDate).toMatch(/before the hire date/);
  });

  it('requires every part of an emergency contact once a row exists', () => {
    const r = employeeFormSchema.safeParse({
      ...EMPTY_EMPLOYEE_FORM,
      firstName: 'A',
      lastName: 'B',
      emergencyContacts: [{ name: 'Kofi', relationship: '', phone: 'abc' }],
    });
    expect(r.success).toBe(false);
    const paths = r.success ? [] : r.error.issues.map((i) => i.path.join('.'));
    expect(paths).toEqual(expect.arrayContaining(['emergencyContacts.0.relationship', 'emergencyContacts.0.phone']));
  });
});

describe('toCreatePayload — registration body', () => {
  it('sends only what was entered, never a credential, user id or invitation', () => {
    const body = toCreatePayload({ ...EMPTY_EMPLOYEE_FORM, firstName: ' Ada ', lastName: 'Lovelace', workEmail: 'ada@wwm.example' }, fullAccess);
    expect(body).toEqual({ firstName: 'Ada', lastName: 'Lovelace', workEmail: 'ada@wwm.example' });
    expect(Object.keys(body)).not.toEqual(expect.arrayContaining(['password', 'userId', 'applicationUserId', 'invite', 'email']));
  });

  it('omits the default status so the server applies its own default, and sends an explicit administrative status', () => {
    expect(toCreatePayload({ ...EMPTY_EMPLOYEE_FORM, firstName: 'A', lastName: 'B' }, fullAccess)).not.toHaveProperty('employmentStatus');
    expect(toCreatePayload({ ...EMPTY_EMPLOYEE_FORM, firstName: 'A', lastName: 'B', employmentStatus: 'probation' }, fullAccess)).toMatchObject({
      employmentStatus: 'probation',
    });
  });

  it('includes sensitive fields only for a caller with employee.sensitive.write', () => {
    const values: EmployeeFormValues = {
      ...EMPTY_EMPLOYEE_FORM,
      firstName: 'A',
      lastName: 'B',
      nationalId: 'GHA-1',
      phoneNumber: '+233200000000',
      residentialAddress: { ...EMPTY_EMPLOYEE_FORM.residentialAddress, line1: '1 Street' },
      emergencyContacts: [{ name: 'K', relationship: 'Spouse', phone: '+233200000001' }],
      notes: 'note',
    };
    const general = toCreatePayload(values, { includeSensitive: false, includeNotes: false });
    expect(general).toEqual({ firstName: 'A', lastName: 'B' });

    const sensitive = toCreatePayload(values, fullAccess);
    expect(sensitive).toMatchObject({
      nationalId: 'GHA-1',
      phoneNumber: '+233200000000',
      residentialAddress: { line1: '1 Street', line2: null, city: null, state: null, postalCode: null, country: null },
      emergencyContacts: [{ name: 'K', relationship: 'Spouse', phone: '+233200000001' }],
      notes: 'note',
    });
  });

  it('sends a manual employee number only when the caller may allocate one', () => {
    const values = { ...EMPTY_EMPLOYEE_FORM, firstName: 'A', lastName: 'B', employeeNumber: 'EMP-9' };
    expect(toCreatePayload(values, fullAccess)).toMatchObject({ employeeNumber: 'EMP-9' });
    expect(toCreatePayload(values, { includeSensitive: true, includeNotes: true, includeEmployeeNumber: false })).not.toHaveProperty('employeeNumber');
  });

  it('converts selections to numeric ids and keeps dates as calendar days', () => {
    const body = toCreatePayload(
      { ...EMPTY_EMPLOYEE_FORM, firstName: 'A', lastName: 'B', departmentId: '3', reportingManagerId: '9', hireDate: '2026-02-01' },
      fullAccess,
    );
    expect(body).toMatchObject({ departmentId: 3, reportingManagerId: 9, hireDate: '2026-02-01' });
  });
});

describe('employeeToFormValues — prefill', () => {
  it('maps every stored field, dates to calendar days and ids to strings', () => {
    const v = employeeToFormValues(storedEmployee());
    expect(v).toMatchObject({
      employeeNumber: 'EMP-0042',
      firstName: 'Ada',
      gender: 'female',
      dateOfBirth: '1990-12-10',
      nationalId: 'GHA-123',
      residentialAddress: { line1: '1 Analytical St', line2: '', city: 'Accra', state: 'Greater Accra', postalCode: '', country: 'Ghana' },
      emergencyContacts: [{ name: 'Charles', relationship: 'Spouse', phone: '+233200000001' }],
      departmentId: '3',
      branchId: '',
      reportingManagerId: '9',
      hireDate: '2024-01-15',
      employmentStatus: 'active',
      notes: 'Internal note',
    });
  });

  it('prefills blanks, not "null", for a redacted record', () => {
    const v = employeeToFormValues(storedEmployee({ sensitiveFieldsRedacted: true, phoneNumber: null, nationalId: null, dateOfBirth: null, emergencyContacts: null, residentialAddress: null }));
    expect(v.phoneNumber).toBe('');
    expect(v.nationalId).toBe('');
    expect(v.dateOfBirth).toBe('');
    expect(v.emergencyContacts).toEqual([]);
  });
});

describe('buildUpdatePatch — only what changed', () => {
  it('sends nothing when the form equals the record, including unchanged sensitive values', () => {
    const employee = storedEmployee();
    const { patch, changedFields } = buildUpdatePatch(employeeToFormValues(employee), employee, fullAccess);
    expect(patch).toEqual({});
    expect(changedFields).toEqual([]);
  });

  it('sends only the edited general field, leaving sensitive values out even when loaded into the form', () => {
    const employee = storedEmployee();
    const values = { ...employeeToFormValues(employee), workEmail: 'ada.l@wwm.example' };
    const { patch, changedFields, blockedFields } = buildUpdatePatch(values, employee, { includeSensitive: false, includeNotes: false });
    expect(patch).toEqual({ workEmail: 'ada.l@wwm.example' });
    expect(changedFields).toEqual(['workEmail']);
    expect(blockedFields).toEqual([]);
  });

  it('never echoes a redacted null back as an erasure', () => {
    const employee = storedEmployee({ sensitiveFieldsRedacted: true, phoneNumber: null, nationalId: null, personalEmail: null, dateOfBirth: null, residentialAddress: null, emergencyContacts: null, gender: null, nationality: null });
    const values = { ...employeeToFormValues(employee), firstName: 'Augusta' };
    const { patch } = buildUpdatePatch(values, employee, { includeSensitive: false, includeNotes: true });
    expect(patch).toEqual({ firstName: 'Augusta' });
    expect(patch).not.toHaveProperty('phoneNumber');
    expect(patch).not.toHaveProperty('nationalId');
  });

  it('reports a changed sensitive field as blocked, not sent, for a caller without the key', () => {
    const employee = storedEmployee();
    const values = { ...employeeToFormValues(employee), nationalId: 'GHA-999', lastName: 'Byron' };
    const { patch, changedFields, blockedFields } = buildUpdatePatch(values, employee, { includeSensitive: false, includeNotes: true });
    expect(patch).toEqual({ lastName: 'Byron' });
    expect(changedFields).toEqual(['lastName']);
    expect(blockedFields).toEqual(['nationalId']);
  });

  it('sends a changed sensitive field for a caller with the key, and clears a value with null', () => {
    const employee = storedEmployee();
    const values = { ...employeeToFormValues(employee), nationalId: 'GHA-999', alternatePhoneNumber: '', nationality: '' };
    const { patch } = buildUpdatePatch(values, employee, fullAccess);
    expect(patch).toEqual({ nationalId: 'GHA-999', nationality: null });
    // alternatePhoneNumber was already null — blank stays "unchanged".
    expect(patch).not.toHaveProperty('alternatePhoneNumber');
  });

  it('treats an emptied address and contact list as null, matching the server', () => {
    const employee = storedEmployee();
    const values = { ...employeeToFormValues(employee), residentialAddress: { ...EMPTY_EMPLOYEE_FORM.residentialAddress }, emergencyContacts: [] };
    const { patch } = buildUpdatePatch(values, employee, fullAccess);
    expect(patch).toEqual({ residentialAddress: null, emergencyContacts: null });
  });

  it('compares dates by calendar day and ids numerically', () => {
    const employee = storedEmployee();
    const same = buildUpdatePatch({ ...employeeToFormValues(employee), hireDate: '2024-01-15', departmentId: '3' }, employee, fullAccess);
    expect(same.patch).toEqual({});
    const changed = buildUpdatePatch({ ...employeeToFormValues(employee), hireDate: '2024-02-01', departmentId: '' }, employee, fullAccess);
    expect(changed.patch).toEqual({ hireDate: '2024-02-01', departmentId: null });
  });

  it('sends a status change and omits notes for a caller without employee.notes.read', () => {
    const employee = storedEmployee({ employmentStatus: 'active' });
    const values = { ...employeeToFormValues(employee), employmentStatus: 'on_leave', notes: 'changed' };
    const r = buildUpdatePatch(values, employee, { includeSensitive: true, includeNotes: false });
    expect(r.patch).toEqual({ employmentStatus: 'on_leave' });
    expect(r.blockedFields).toEqual(['notes']);
  });
});

describe('date helpers', () => {
  it('toDateOnly keeps the UTC calendar day and tolerates junk', () => {
    expect(toDateOnly('2026-01-15T00:00:00.000Z')).toBe('2026-01-15');
    expect(toDateOnly(null)).toBe('');
    expect(toDateOnly('nonsense')).toBe('');
  });
  it('formatDateOnly renders without a timezone shift', () => {
    expect(formatDateOnly('2026-01-15T00:00:00.000Z')).toMatch(/15/);
    expect(formatDateOnly('2026-01-15T00:00:00.000Z')).toMatch(/2026/);
    expect(formatDateOnly(null)).toBeNull();
  });
});
