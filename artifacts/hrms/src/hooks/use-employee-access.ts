import { useMemo } from 'react';
import { useCapabilities } from '@/hooks/use-capabilities';

/**
 * What the caller may do to EMPLOYEE RECORDS in `organizationId`, read from
 * their effective permission keys — the same `MembershipSummary.permissions`
 * the server computes from membership_roles → role_permissions — and never
 * from a role name. A tenant's custom role is honoured the moment it holds the
 * key; a renamed template loses nothing.
 *
 * Every key below is the exact string the API's requirePermission evaluates
 * (lib/db/src/seed/roles-permissions-definitions.ts):
 *
 *   employee.read              directory and detail reads
 *   employee.write             create, update, link, lifecycle, documents,
 *                              skills/qualifications/certifications, exit
 *   employee.sensitive.read    personal identity/contact fields in responses
 *   employee.sensitive.write   changing those fields (POST / PATCH)
 *   employee.notes.read        reading and writing HR notes
 *   employee_number.allocate   staff-number allocate / release
 *   personnel_file.manage      creating a personnel file
 *   personnel_file.movement.write  physical custody movements
 *
 * Fails closed while the membership query is in flight, so a control is hidden
 * rather than flashing in and then being refused.
 *
 * This decides only what to SHOW. The API enforces each of these on every
 * request, and additionally refuses administrative actions on the actor's own
 * record (`self_administration_forbidden`) — see `isOwnRecord` on the pages.
 */
export const EMPLOYEE_PERMISSION = {
  read: 'employee.read',
  write: 'employee.write',
  sensitiveRead: 'employee.sensitive.read',
  sensitiveWrite: 'employee.sensitive.write',
  notesRead: 'employee.notes.read',
  numberAllocate: 'employee_number.allocate',
  personnelFileManage: 'personnel_file.manage',
  personnelFileMovementWrite: 'personnel_file.movement.write',
} as const;

export interface EmployeeAccess {
  canRead: boolean;
  canWrite: boolean;
  canReadSensitive: boolean;
  canWriteSensitive: boolean;
  canReadNotes: boolean;
  canAllocateNumber: boolean;
  canManagePersonnelFile: boolean;
  canWriteCustody: boolean;
  /** Holds every one of these permissions (for the few section-specific keys). */
  can: (...keys: string[]) => boolean;
  isLoading: boolean;
}

export function useEmployeeAccess(organizationId: number): EmployeeAccess {
  const { can, isLoading } = useCapabilities(organizationId);
  return useMemo(
    () => ({
      canRead: can(EMPLOYEE_PERMISSION.read),
      canWrite: can(EMPLOYEE_PERMISSION.write),
      canReadSensitive: can(EMPLOYEE_PERMISSION.sensitiveRead),
      canWriteSensitive: can(EMPLOYEE_PERMISSION.sensitiveWrite),
      canReadNotes: can(EMPLOYEE_PERMISSION.notesRead),
      canAllocateNumber: can(EMPLOYEE_PERMISSION.numberAllocate),
      canManagePersonnelFile: can(EMPLOYEE_PERMISSION.personnelFileManage),
      canWriteCustody: can(EMPLOYEE_PERMISSION.personnelFileMovementWrite),
      can,
      isLoading,
    }),
    [can, isLoading],
  );
}

/**
 * Whether `employee` is the acting user's own record. The server decides this
 * from employee_user_links (never from names or emails); the response exposes
 * that link as `linkedApplicationUserId`, so the UI can anticipate the
 * `self_administration_forbidden` refusal and say so before a click fails.
 * An unlinked record is never "own", exactly as on the server.
 */
export function isOwnEmployeeRecord(
  employee: { linkedApplicationUserId?: number | null } | undefined,
  currentUserId: number | undefined,
): boolean {
  if (!employee || currentUserId == null) return false;
  return employee.linkedApplicationUserId != null && employee.linkedApplicationUserId === currentUserId;
}
