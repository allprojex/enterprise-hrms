/**
 * PATCH /users/me — the ACCOUNT profile, not the employee record.
 *
 * `users` is a global, per-login table. For anyone linked to an employee
 * record (employee_user_links), their name, job title and department are
 * owned by HR on `employees` (changed through HR edits or WS-13 data-change
 * requests). Letting the account copy of those fields be self-edited made it
 * a second, unaudited, employee-controlled identity that other surfaces
 * (signature certificates, acknowledgements, membership lists) then read.
 *
 * Rules:
 *   - linked account   → firstName/lastName/jobTitle/department are read-only;
 *                         a request that would CHANGE one is refused (sending
 *                         the unchanged current value is harmless and accepted,
 *                         so a client resubmitting the whole form still works).
 *   - unlinked account  → (platform/Super Admin/bootstrap accounts, users not yet
 *                         linked) the account row IS their identity; all fields
 *                         stay editable, now validated.
 *   - phoneNumber       → account contact only (nothing outside /auth/me and
 *                         this route reads users.phoneNumber); editable for
 *                         everyone, validated.
 * Every effective change is audited with the changed field NAMES only.
 */
import { eq } from "drizzle-orm";
import { db, employeeUserLinksTable, type User } from "@workspace/db";

export const HR_OWNED_ACCOUNT_FIELDS = ["firstName", "lastName", "jobTitle", "department"] as const;
type AccountField = (typeof HR_OWNED_ACCOUNT_FIELDS)[number] | "phoneNumber";

const NAME_MAX = 100;
const TEXT_MAX = 150;
// Same shape custom-field phone values use (lib/customFields/fieldTypes.ts).
const PHONE_RE = /^\+?[0-9\s()-]{6,32}$/;

export class AccountProfileValidationError extends Error {}
export class AccountIdentityManagedByHrError extends Error {
  constructor() {
    super("Your name, job title and department come from your organization's employee record and can only be changed by HR.");
  }
}

/** Names are required columns; the other account fields are nullable. */
export interface AccountProfilePatch {
  firstName?: string;
  lastName?: string;
  jobTitle?: string | null;
  department?: string | null;
  phoneNumber?: string | null;
}

function requiredName(value: unknown, label: string): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) throw new AccountProfileValidationError(`${label} is required.`);
  if (trimmed.length > NAME_MAX) throw new AccountProfileValidationError(`${label} must be ${NAME_MAX} characters or fewer.`);
  return trimmed;
}

function optionalText(value: unknown, label: string): string | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  if (trimmed.length > TEXT_MAX) throw new AccountProfileValidationError(`${label} must be ${TEXT_MAX} characters or fewer.`);
  return trimmed;
}

function optionalPhone(value: unknown): string | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  if (!PHONE_RE.test(trimmed)) {
    throw new AccountProfileValidationError("Phone number may contain only digits, spaces, brackets, hyphens and a leading +, 6–32 characters.");
  }
  return trimmed;
}

/**
 * Normalizes the (already schema-parsed) body and returns only the fields
 * whose value actually differs from the current account row.
 */
export function computeAccountProfileChanges(
  current: Pick<User, AccountField>,
  body: Partial<Record<AccountField, unknown>>,
): AccountProfilePatch {
  const next: AccountProfilePatch = {};
  if (body.firstName !== undefined) next.firstName = requiredName(body.firstName, "First name");
  if (body.lastName !== undefined) next.lastName = requiredName(body.lastName, "Last name");
  if (body.jobTitle !== undefined) next.jobTitle = optionalText(body.jobTitle, "Job title");
  if (body.department !== undefined) next.department = optionalText(body.department, "Department");
  if (body.phoneNumber !== undefined) next.phoneNumber = optionalPhone(body.phoneNumber);

  const changes: AccountProfilePatch = {};
  for (const key of Object.keys(next) as AccountField[]) {
    if ((current[key] ?? null) !== next[key]) Object.assign(changes, { [key]: next[key] });
  }
  return changes;
}

/** True when this login is linked to any employee record, in any organization. */
export async function isLinkedToEmployee(applicationUserId: number): Promise<boolean> {
  const [link] = await db
    .select({ id: employeeUserLinksTable.id })
    .from(employeeUserLinksTable)
    .where(eq(employeeUserLinksTable.applicationUserId, applicationUserId))
    .limit(1);
  return link != null;
}

/** Throws AccountIdentityManagedByHrError when a linked account tries to change an HR-owned field. */
export function assertNoHrOwnedChanges(changes: AccountProfilePatch, linked: boolean): void {
  if (!linked) return;
  if (HR_OWNED_ACCOUNT_FIELDS.some((field) => field in changes)) throw new AccountIdentityManagedByHrError();
}
