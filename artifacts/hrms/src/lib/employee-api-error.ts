/**
 * Reading what the employee API actually said.
 *
 * The generated client throws `ApiError` from lib/api-client-react's
 * custom-fetch: the server's JSON body lives on `err.data`, never on the error
 * object itself. Several pages used to test `'error' in err` at the top level,
 * which is never true for an ApiError, so every toast fell back to its generic
 * copy and the one thing the server went to the trouble of saying — a
 * `code`, the refused `fields`, the duplicated `field` — was thrown away.
 *
 * This module is the single place that shape is interpreted. It is purely
 * presentational: the server has already decided; this only decides what to
 * tell the person.
 *
 * Body shapes this understands (artifacts/api-server/src/routes/employees.ts):
 *   400 { error }                                   validation / status rule
 *   403 { error, code: 'self_administration_forbidden', employeeId }
 *   403 { error, fields: string[], requiredPermission }   refused sensitive write
 *   404 { error }
 *   409 { error, field: 'nationalId' | 'passportNumber' } duplicate identifier
 *   409 { error }                                   employee number collision
 */

export const SELF_ADMINISTRATION_FORBIDDEN = 'self_administration_forbidden';

/**
 * Client-side code (never sent by the server): the edit form contains changes
 * to fields the caller is not permitted to write. The submission is refused
 * whole rather than silently saving only the permitted part.
 */
export const RESTRICTED_FIELDS_CHANGED = 'restricted_fields_changed';

export interface EmployeeApiErrorDetails {
  /** HTTP status, or null when the failure never reached the server. */
  status: number | null;
  /** The server's own sentence, when it sent one. */
  message: string | null;
  /** Machine-readable code, e.g. `self_administration_forbidden`. */
  code: string | null;
  /** Fields a refused sensitive write named. */
  fields: string[];
  /** The permission key the server said was missing. */
  requiredPermission: string | null;
  /** The single field a 409 duplicate-identifier response named. */
  field: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Read an ApiError (or anything thrown) into the details above, never throwing. */
export function describeEmployeeApiError(err: unknown): EmployeeApiErrorDetails {
  const empty: EmployeeApiErrorDetails = {
    status: null,
    message: null,
    code: null,
    fields: [],
    requiredPermission: null,
    field: null,
  };
  if (!isRecord(err)) return empty;

  const status = typeof err.status === 'number' ? err.status : null;
  // ApiError keeps the body on `data`; tests and older call sites sometimes
  // hand the body itself, so accept both.
  const body = isRecord(err.data) ? err.data : err;

  const message = typeof body.error === 'string' && body.error.trim() ? body.error : null;
  const code = typeof body.code === 'string' ? body.code : null;
  const fields = Array.isArray(body.fields) ? body.fields.filter((f): f is string => typeof f === 'string') : [];
  const requiredPermission = typeof body.requiredPermission === 'string' ? body.requiredPermission : null;
  const field = typeof body.field === 'string' ? body.field : null;

  return { status, message, code, fields, requiredPermission, field };
}

/** True when the server refused because the actor targeted their own record. */
export function isSelfAdministrationError(err: unknown): boolean {
  return describeEmployeeApiError(err).code === SELF_ADMINISTRATION_FORBIDDEN;
}

/**
 * The sentence shown when a self-administration denial comes back. The
 * server's own message already says what to do; this is the fallback when the
 * body carried only the code.
 */
export const SELF_ADMINISTRATION_MESSAGE =
  'You cannot perform this administrative action on your own employee record. Ask another authorized HR officer or organisation administrator to make the change, or submit a data-change request from My Requests.';

/**
 * A toast-ready description for an employee mutation failure. Prefers the
 * server's sentence, then a code-specific explanation, then `fallback`.
 */
export function employeeErrorDescription(err: unknown, fallback = 'Please try again.'): string {
  const d = describeEmployeeApiError(err);
  if (d.code === SELF_ADMINISTRATION_FORBIDDEN) return d.message ?? SELF_ADMINISTRATION_MESSAGE;
  if (d.message) return d.message;
  if (d.status === 403) return 'You do not have permission to do this.';
  if (d.status === 404) return 'This employee record could not be found.';
  return fallback;
}
