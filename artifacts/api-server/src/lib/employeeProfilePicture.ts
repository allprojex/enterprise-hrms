/**
 * Shared employee profile-picture logic, used by both the HR-administrator
 * routes (routes/employees.ts, gated on employee.write/employee.read) and
 * the self-service routes (routes/me.ts, own-identity-only, no permission
 * key) — one storage/processing implementation, two different callers with
 * different identity-resolution and permission rules layered on top.
 */
import { eq } from "drizzle-orm";
import { db, employeesTable, type Employee } from "@workspace/db";
import { validateImageUpload, processAvatarImage } from "./imageProcessing";
import { writeOrgFile, readOrgFile, deleteOrgFile } from "./fileStorage";

export { InvalidImageError } from "./imageProcessing";

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
  actorApplicationUserId: number,
): Promise<Employee> {
  validateImageUpload(file);
  const processed = await processAvatarImage(file.buffer);
  const key = await writeOrgFile(organizationId, "avatars", "jpg", processed);

  if (employee.profilePictureKey) {
    await deleteOrgFile(organizationId, employee.profilePictureKey);
  }

  const [updated] = await db
    .update(employeesTable)
    .set({ profilePictureKey: key, updatedBy: actorApplicationUserId })
    .where(eq(employeesTable.id, employee.id))
    .returning();
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

/** Deletes the stored picture (if any) and clears the column. Returns the updated employee row. */
export async function clearEmployeeProfilePicture(
  organizationId: number,
  employee: Employee,
  actorApplicationUserId: number,
): Promise<Employee> {
  if (employee.profilePictureKey) {
    await deleteOrgFile(organizationId, employee.profilePictureKey);
  }

  const [updated] = await db
    .update(employeesTable)
    .set({ profilePictureKey: null, updatedBy: actorApplicationUserId })
    .where(eq(employeesTable.id, employee.id))
    .returning();
  return updated;
}
