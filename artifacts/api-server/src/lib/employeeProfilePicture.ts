/**
 * Shared employee profile-picture logic, used by both the HR-administrator
 * routes (routes/employees.ts, gated on employee.write/employee.read) and
 * the self-service routes (routes/me.ts, own-identity-only, no permission
 * key) — one storage/processing implementation, two different callers with
 * different identity-resolution and permission rules layered on top.
 *
 * Both write paths are audited here, once, so neither caller can skip it.
 * The audit records who changed which employee's picture and through which
 * path — never the image, its storage key or any URL.
 */
import { eq } from "drizzle-orm";
import { db, employeesTable, type Employee } from "@workspace/db";
import { validateImageUpload, processAvatarImage } from "./imageProcessing";
import { writeOrgFile, readOrgFile, deleteOrgFile } from "./fileStorage";
import { recordAuditEvent } from "./auditLog";

export { InvalidImageError } from "./imageProcessing";

export interface ProfilePictureActor {
  applicationUserId: number;
  membershipId: number;
  /** Which route family made the change: the employee themselves, or HR on their behalf. */
  via: "self_service" | "hr_admin";
}

/**
 * Validates, processes (square-crop, EXIF-stripped, re-encoded JPEG), and
 * stores a new profile picture for `employeeId`, replacing (and deleting)
 * any previous one. Returns the updated employee row. Throws
 * InvalidImageError on an invalid/oversized/unsupported file.
 */
export async function applyEmployeeProfilePicture(
  organizationId: number,
  employee: Employee,
  file: { mimetype: string; size: number; buffer: Buffer },
  actor: ProfilePictureActor,
): Promise<Employee> {
  validateImageUpload(file);
  const processed = await processAvatarImage(file.buffer);
  const key = await writeOrgFile(organizationId, "avatars", "jpg", processed);

  const replacedExisting = employee.profilePictureKey != null;
  if (employee.profilePictureKey) {
    await deleteOrgFile(organizationId, employee.profilePictureKey);
  }

  const [updated] = await db
    .update(employeesTable)
    .set({ profilePictureKey: key, updatedBy: actor.applicationUserId })
    .where(eq(employeesTable.id, employee.id))
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: actor.applicationUserId,
    actorMembershipId: actor.membershipId,
    organizationId,
    eventType: "employee.profile_picture_updated",
    targetType: "employee",
    targetId: String(employee.id),
    metadata: { via: actor.via, replacedExisting },
  });
  return updated;
}

/** Reads the stored picture's bytes, or null if there is none (or it's gone from disk). */
export async function readEmployeeProfilePictureBuffer(
  organizationId: number,
  employee: Employee,
): Promise<Buffer | null> {
  if (!employee.profilePictureKey) return null;
  try {
    return await readOrgFile(organizationId, employee.profilePictureKey);
  } catch {
    return null;
  }
}

/**
 * Deletes the stored picture (if any) and clears the column. Returns the
 * updated employee row. Audited only when there was a picture to remove — a
 * no-op removal changes nothing.
 */
export async function clearEmployeeProfilePicture(
  organizationId: number,
  employee: Employee,
  actor: ProfilePictureActor,
): Promise<Employee> {
  const hadPicture = employee.profilePictureKey != null;
  if (employee.profilePictureKey) {
    await deleteOrgFile(organizationId, employee.profilePictureKey);
  }

  const [updated] = await db
    .update(employeesTable)
    .set({ profilePictureKey: null, updatedBy: actor.applicationUserId })
    .where(eq(employeesTable.id, employee.id))
    .returning();

  if (hadPicture) {
    await recordAuditEvent({
      actorApplicationUserId: actor.applicationUserId,
      actorMembershipId: actor.membershipId,
      organizationId,
      eventType: "employee.profile_picture_removed",
      targetType: "employee",
      targetId: String(employee.id),
      metadata: { via: actor.via },
    });
  }
  return updated;
}
