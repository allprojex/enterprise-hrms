import type { Employee } from '@workspace/api-client-react';

/**
 * Whether an employee record is linked to a login account.
 *
 * This matters wherever the product asks an employee to DO something — sign a
 * form, confirm their own details — because a workflow stage that resolves to
 * the employee has no actor at all until the link exists. It is presentation
 * only: the server enforces the same fact independently.
 */
export function employeeHasAccount(employee: Pick<Employee, 'linkedApplicationUserId'>): boolean {
  return employee.linkedApplicationUserId != null;
}

/** "Ama Mensah · EMP-0050" — name first, staff number only when there is one. */
export function employeeLabel(employee: Pick<Employee, 'firstName' | 'lastName' | 'employeeNumber'>): string {
  const name = `${employee.firstName} ${employee.lastName}`.trim();
  return employee.employeeNumber ? `${name} · ${employee.employeeNumber}` : name;
}

/** The one sentence HR must see before relying on an employee being able to sign. */
export const NO_ACCOUNT_NOTICE =
  'No account yet — this employee cannot review or sign the form until an account is linked.';
