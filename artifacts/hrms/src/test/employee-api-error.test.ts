/**
 * Reading the employee API's error bodies (Phase 2).
 *
 * The generated client throws ApiError with the server's JSON on `data`.
 * These tests pin that `code`, `fields`, `requiredPermission` and `field` are
 * read from there, so a self_administration_forbidden refusal or a refused
 * sensitive write is explained rather than collapsed into "Please try again".
 */
import { describe, it, expect } from 'vitest';
import {
  SELF_ADMINISTRATION_MESSAGE,
  describeEmployeeApiError,
  employeeErrorDescription,
  isSelfAdministrationError,
} from '@/lib/employee-api-error';

function apiError(status: number, data: unknown) {
  // Shape of lib/api-client-react's ApiError: status + data; the body is never on the error itself.
  return Object.assign(new Error('Request failed'), { name: 'ApiError', status, data });
}

describe('describeEmployeeApiError', () => {
  it('reads the self-administration code and message from the body', () => {
    const d = describeEmployeeApiError(apiError(403, { error: 'You cannot perform this administrative action on your own employee record.', code: 'self_administration_forbidden', employeeId: 42 }));
    expect(d.status).toBe(403);
    expect(d.code).toBe('self_administration_forbidden');
    expect(d.message).toMatch(/own employee record/);
    expect(isSelfAdministrationError(apiError(403, { error: 'x', code: 'self_administration_forbidden' }))).toBe(true);
    expect(isSelfAdministrationError(apiError(403, { error: 'Forbidden' }))).toBe(false);
  });

  it('reads the refused sensitive fields and the missing permission', () => {
    const d = describeEmployeeApiError(apiError(403, { error: 'Sensitive fields require employee.sensitive.write', fields: ['nationalId', 'phoneNumber'], requiredPermission: 'employee.sensitive.write' }));
    expect(d.fields).toEqual(['nationalId', 'phoneNumber']);
    expect(d.requiredPermission).toBe('employee.sensitive.write');
  });

  it('reads the duplicated identifier field from a 409', () => {
    const d = describeEmployeeApiError(apiError(409, { error: 'An employee with this national ID already exists', field: 'nationalId' }));
    expect(d.status).toBe(409);
    expect(d.field).toBe('nationalId');
  });

  it('tolerates a body handed directly, a non-object, and a body without the expected keys', () => {
    expect(describeEmployeeApiError({ error: 'plain body', code: 'x' }).message).toBe('plain body');
    expect(describeEmployeeApiError('boom')).toMatchObject({ status: null, message: null, code: null, fields: [], field: null });
    expect(describeEmployeeApiError(apiError(500, null))).toMatchObject({ status: 500, message: null });
    expect(describeEmployeeApiError(apiError(400, { error: '   ' })).message).toBeNull();
  });
});

describe('employeeErrorDescription', () => {
  it('prefers the server sentence, then the code, then status, then the fallback', () => {
    expect(employeeErrorDescription(apiError(400, { error: 'Hire date cannot be before date of birth' }))).toBe('Hire date cannot be before date of birth');
    expect(employeeErrorDescription(apiError(403, { code: 'self_administration_forbidden' }))).toBe(SELF_ADMINISTRATION_MESSAGE);
    expect(employeeErrorDescription(apiError(403, {}))).toMatch(/permission/);
    expect(employeeErrorDescription(apiError(404, {}))).toMatch(/could not be found/);
    expect(employeeErrorDescription(new Error('network'), 'Custom fallback')).toBe('Custom fallback');
  });
});
