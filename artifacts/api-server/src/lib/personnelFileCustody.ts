/**
 * Phase 3H, W116 — Physical-File Custody & Movement (frozen plan §7b).
 *
 * Custody applies either directly to a personnel_files row (no volumes in
 * use) or to one of its personnel_file_volumes rows — every function here
 * accepts an optional volumeId and locks/updates whichever row is the real
 * custody target, never both. personnel_file_movements is append-only —
 * every action inserts one new event; nothing here ever edits or deletes an
 * existing movement row. "Overdue" is never a column — always derived live
 * in isOverdue()/getCustodyDetail() from the current unresolved checked_out
 * event's own expectedReturnDate.
 */
import { and, eq, isNull, desc, inArray } from "drizzle-orm";
import {
  db,
  personnelFilesTable,
  personnelFileVolumesTable,
  personnelFileMovementsTable,
  recordsLocationsTable,
  type PersonnelFile,
  type PersonnelFileVolume,
  type PersonnelFileMovement,
} from "@workspace/db";
import { isUniqueViolation } from "./dbErrors";
import { recordAuditEvent } from "./auditLog";

export type CustodyState = "in_registry" | "checked_out" | "missing";

type QueryClient = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export class PersonnelFileNotFoundForCustodyError extends Error {
  constructor() {
    super("Personnel file not found");
    this.name = "PersonnelFileNotFoundForCustodyError";
  }
}

export class PersonnelFileVolumeNotFoundError extends Error {
  constructor() {
    super("Personnel file volume not found");
    this.name = "PersonnelFileVolumeNotFoundError";
  }
}

export class RecordsLocationNotFoundForCustodyError extends Error {
  constructor() {
    super("Records location not found");
    this.name = "RecordsLocationNotFoundForCustodyError";
  }
}

export class RecordsLocationRetiredForCustodyError extends Error {
  constructor() {
    super("This records location is retired and cannot receive files");
    this.name = "RecordsLocationRetiredForCustodyError";
  }
}

export class IllegalCustodyTransitionError extends Error {
  constructor(action: string, currentState: CustodyState) {
    super(`Cannot ${action} — current state is "${currentState}"`);
    this.name = "IllegalCustodyTransitionError";
  }
}

export class MissingReasonRequiredError extends Error {
  constructor() {
    super("A reason is required when marking a personnel file missing");
    this.name = "MissingReasonRequiredError";
  }
}

const MAX_VOLUME_ATTEMPTS = 20;

// ---------------------------------------------------------------------------
// Volumes
// ---------------------------------------------------------------------------

/**
 * Sequential per personnel file, enforced by the table's own unique index
 * (personnelFileId, volumeNumber) — never COUNT+1 alone. The personnel_files
 * row is locked first, serializing concurrent "create next volume" calls
 * for the same file; the unique index plus a bounded retry loop is the
 * belt-and-suspenders backstop, mirroring the numbering engine's own
 * collision-retry pattern (W114) rather than inventing a new one.
 */
export async function createNextPersonnelFileVolume(
  client: QueryClient,
  params: { organizationId: number; personnelFileId: number; actorApplicationUserId: number | null; actorMembershipId: number | null },
): Promise<PersonnelFileVolume> {
  for (let attempt = 1; attempt <= MAX_VOLUME_ATTEMPTS; attempt++) {
    try {
      const volume = await client.transaction(async (tx) => {
        const [file] = await tx
          .select()
          .from(personnelFilesTable)
          .where(and(eq(personnelFilesTable.id, params.personnelFileId), eq(personnelFilesTable.organizationId, params.organizationId)))
          .for("update");
        if (!file) throw new PersonnelFileNotFoundForCustodyError();

        const existing = await tx
          .select({ volumeNumber: personnelFileVolumesTable.volumeNumber })
          .from(personnelFileVolumesTable)
          .where(eq(personnelFileVolumesTable.personnelFileId, params.personnelFileId));
        const nextNumber = existing.reduce((max, r) => Math.max(max, r.volumeNumber), 0) + 1;

        const [created] = await tx
          .insert(personnelFileVolumesTable)
          .values({
            organizationId: params.organizationId,
            personnelFileId: params.personnelFileId,
            volumeNumber: nextNumber,
          })
          .returning();
        return created;
      });

      await recordAuditEvent({
        actorApplicationUserId: params.actorApplicationUserId,
        actorMembershipId: params.actorMembershipId,
        organizationId: params.organizationId,
        eventType: "personnel_file_volume.created",
        targetType: "personnel_file",
        targetId: String(params.personnelFileId),
        afterState: { volumeId: volume.id, volumeNumber: volume.volumeNumber },
      });

      return volume;
    } catch (err) {
      if (isUniqueViolation(err) && attempt < MAX_VOLUME_ATTEMPTS) continue;
      throw err;
    }
  }
  throw new Error("Could not allocate a volume number after repeated attempts");
}

export async function listPersonnelFileVolumes(organizationId: number, personnelFileId: number): Promise<PersonnelFileVolume[]> {
  return db
    .select()
    .from(personnelFileVolumesTable)
    .where(and(eq(personnelFileVolumesTable.organizationId, organizationId), eq(personnelFileVolumesTable.personnelFileId, personnelFileId)))
    .orderBy(personnelFileVolumesTable.volumeNumber);
}

// ---------------------------------------------------------------------------
// Custody target resolution (file-level vs volume-level)
// ---------------------------------------------------------------------------

interface CustodyTargetRow {
  currentCustodyState: CustodyState;
  currentLocationId: number | null;
}

async function lockCustodyTarget(
  tx: QueryClient,
  organizationId: number,
  personnelFileId: number,
  volumeId: number | null | undefined,
): Promise<CustodyTargetRow> {
  const [file] = await tx
    .select()
    .from(personnelFilesTable)
    .where(and(eq(personnelFilesTable.id, personnelFileId), eq(personnelFilesTable.organizationId, organizationId)))
    .for("update");
  if (!file) throw new PersonnelFileNotFoundForCustodyError();

  if (volumeId == null) {
    return { currentCustodyState: file.currentCustodyState as CustodyState, currentLocationId: file.currentLocationId };
  }

  const [volume] = await tx
    .select()
    .from(personnelFileVolumesTable)
    .where(and(eq(personnelFileVolumesTable.id, volumeId), eq(personnelFileVolumesTable.organizationId, organizationId), eq(personnelFileVolumesTable.personnelFileId, personnelFileId)))
    .for("update");
  if (!volume) throw new PersonnelFileVolumeNotFoundError();

  return { currentCustodyState: volume.currentCustodyState as CustodyState, currentLocationId: volume.currentLocationId };
}

async function writeCustodyTarget(
  tx: QueryClient,
  personnelFileId: number,
  volumeId: number | null | undefined,
  patch: { currentCustodyState: CustodyState; currentLocationId: number | null },
): Promise<void> {
  if (volumeId == null) {
    await tx.update(personnelFilesTable).set(patch).where(eq(personnelFilesTable.id, personnelFileId));
  } else {
    await tx.update(personnelFileVolumesTable).set(patch).where(eq(personnelFileVolumesTable.id, volumeId));
  }
}

async function assertLocationUsable(tx: QueryClient, organizationId: number, locationId: number): Promise<void> {
  const [location] = await tx
    .select()
    .from(recordsLocationsTable)
    .where(and(eq(recordsLocationsTable.id, locationId), eq(recordsLocationsTable.organizationId, organizationId)))
    .limit(1);
  if (!location) throw new RecordsLocationNotFoundForCustodyError();
  if (location.status === "retired") throw new RecordsLocationRetiredForCustodyError();
}

// ---------------------------------------------------------------------------
// Movement actions
// ---------------------------------------------------------------------------

interface MovementActionParams {
  organizationId: number;
  personnelFileId: number;
  volumeId?: number | null;
  actorMembershipId: number | null;
  actorApplicationUserId: number | null;
}

export async function checkoutPersonnelFile(
  client: QueryClient,
  params: MovementActionParams & { purpose?: string | null; destination: string; expectedReturnDate?: Date | null; notes?: string | null },
): Promise<PersonnelFileMovement> {
  const movement = await client.transaction(async (tx) => {
    const target = await lockCustodyTarget(tx, params.organizationId, params.personnelFileId, params.volumeId);
    if (target.currentCustodyState !== "in_registry") {
      throw new IllegalCustodyTransitionError("check out", target.currentCustodyState);
    }

    const [inserted] = await tx
      .insert(personnelFileMovementsTable)
      .values({
        organizationId: params.organizationId,
        personnelFileId: params.personnelFileId,
        volumeId: params.volumeId ?? null,
        eventType: "checked_out",
        actorMembershipId: params.actorMembershipId,
        purpose: params.purpose ?? null,
        destination: params.destination,
        expectedReturnDate: params.expectedReturnDate ?? null,
        notes: params.notes ?? null,
      })
      .returning();

    // Checked out — no longer sitting in any registry location.
    await writeCustodyTarget(tx, params.personnelFileId, params.volumeId, { currentCustodyState: "checked_out", currentLocationId: null });

    return inserted;
  });

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "personnel_file.checked_out",
    targetType: "personnel_file",
    targetId: String(params.personnelFileId),
    afterState: { volumeId: params.volumeId ?? null, destination: params.destination, movementId: movement.id },
  });

  return movement;
}

export async function returnPersonnelFile(
  client: QueryClient,
  params: MovementActionParams & { locationId?: number | null; notes?: string | null },
): Promise<PersonnelFileMovement> {
  const movement = await client.transaction(async (tx) => {
    const target = await lockCustodyTarget(tx, params.organizationId, params.personnelFileId, params.volumeId);
    // Valid from checked_out (the ordinary case) or missing (found and
    // brought back by the person who had it) — frozen plan §7b.
    if (target.currentCustodyState !== "checked_out" && target.currentCustodyState !== "missing") {
      throw new IllegalCustodyTransitionError("return", target.currentCustodyState);
    }

    if (params.locationId != null) {
      await assertLocationUsable(tx, params.organizationId, params.locationId);
    }

    const [inserted] = await tx
      .insert(personnelFileMovementsTable)
      .values({
        organizationId: params.organizationId,
        personnelFileId: params.personnelFileId,
        volumeId: params.volumeId ?? null,
        eventType: "returned",
        actorMembershipId: params.actorMembershipId,
        notes: params.notes ?? null,
      })
      .returning();

    await writeCustodyTarget(tx, params.personnelFileId, params.volumeId, { currentCustodyState: "in_registry", currentLocationId: params.locationId ?? null });

    return inserted;
  });

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "personnel_file.returned",
    targetType: "personnel_file",
    targetId: String(params.personnelFileId),
    afterState: { volumeId: params.volumeId ?? null, locationId: params.locationId ?? null, movementId: movement.id },
  });

  return movement;
}

export async function markPersonnelFileMissing(
  client: QueryClient,
  params: MovementActionParams & { notes: string },
): Promise<PersonnelFileMovement> {
  if (!params.notes || !params.notes.trim()) throw new MissingReasonRequiredError();

  const movement = await client.transaction(async (tx) => {
    const target = await lockCustodyTarget(tx, params.organizationId, params.personnelFileId, params.volumeId);
    if (target.currentCustodyState !== "checked_out") {
      throw new IllegalCustodyTransitionError("mark missing", target.currentCustodyState);
    }

    const [inserted] = await tx
      .insert(personnelFileMovementsTable)
      .values({
        organizationId: params.organizationId,
        personnelFileId: params.personnelFileId,
        volumeId: params.volumeId ?? null,
        eventType: "marked_missing",
        actorMembershipId: params.actorMembershipId,
        notes: params.notes,
      })
      .returning();

    // Last known shelf slot is no longer meaningful — cleared, not
    // fabricated as "last seen here."
    await writeCustodyTarget(tx, params.personnelFileId, params.volumeId, { currentCustodyState: "missing", currentLocationId: null });

    return inserted;
  });

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "personnel_file.missing",
    targetType: "personnel_file",
    targetId: String(params.personnelFileId),
    afterState: { volumeId: params.volumeId ?? null, movementId: movement.id },
  });

  return movement;
}

export async function recoverPersonnelFile(
  client: QueryClient,
  params: MovementActionParams & { locationId?: number | null; notes?: string | null },
): Promise<PersonnelFileMovement> {
  const movement = await client.transaction(async (tx) => {
    const target = await lockCustodyTarget(tx, params.organizationId, params.personnelFileId, params.volumeId);
    if (target.currentCustodyState !== "missing") {
      throw new IllegalCustodyTransitionError("recover", target.currentCustodyState);
    }

    if (params.locationId != null) {
      await assertLocationUsable(tx, params.organizationId, params.locationId);
    }

    const [inserted] = await tx
      .insert(personnelFileMovementsTable)
      .values({
        organizationId: params.organizationId,
        personnelFileId: params.personnelFileId,
        volumeId: params.volumeId ?? null,
        eventType: "recovered",
        actorMembershipId: params.actorMembershipId,
        notes: params.notes ?? null,
      })
      .returning();

    await writeCustodyTarget(tx, params.personnelFileId, params.volumeId, { currentCustodyState: "in_registry", currentLocationId: params.locationId ?? null });

    return inserted;
  });

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "personnel_file.recovered",
    targetType: "personnel_file",
    targetId: String(params.personnelFileId),
    afterState: { volumeId: params.volumeId ?? null, locationId: params.locationId ?? null, movementId: movement.id },
  });

  return movement;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listMovementHistory(
  organizationId: number,
  personnelFileId: number,
  volumeId?: number | null,
): Promise<PersonnelFileMovement[]> {
  const conditions = [eq(personnelFileMovementsTable.organizationId, organizationId), eq(personnelFileMovementsTable.personnelFileId, personnelFileId)];
  if (volumeId != null) conditions.push(eq(personnelFileMovementsTable.volumeId, volumeId));
  return db
    .select()
    .from(personnelFileMovementsTable)
    .where(and(...conditions))
    .orderBy(desc(personnelFileMovementsTable.occurredAt));
}

/**
 * Overdue is always computed here, never stored: currentCustodyState must
 * be "checked_out" AND the most recent checked_out event's own
 * expectedReturnDate must be in the past. Never a background job, never a
 * persisted flag (frozen plan §7b's own explicit instruction).
 */
export async function isOverdue(organizationId: number, personnelFileId: number, volumeId: number | null | undefined, currentCustodyState: CustodyState, now: Date = new Date()): Promise<boolean> {
  if (currentCustodyState !== "checked_out") return false;

  const conditions = [
    eq(personnelFileMovementsTable.organizationId, organizationId),
    eq(personnelFileMovementsTable.personnelFileId, personnelFileId),
    eq(personnelFileMovementsTable.eventType, "checked_out"),
  ];
  if (volumeId != null) conditions.push(eq(personnelFileMovementsTable.volumeId, volumeId));
  else conditions.push(isNull(personnelFileMovementsTable.volumeId));

  const [lastCheckout] = await db
    .select({ expectedReturnDate: personnelFileMovementsTable.expectedReturnDate })
    .from(personnelFileMovementsTable)
    .where(and(...conditions))
    .orderBy(desc(personnelFileMovementsTable.occurredAt))
    .limit(1);

  if (!lastCheckout?.expectedReturnDate) return false;
  return lastCheckout.expectedReturnDate.getTime() < now.getTime();
}

export interface CustodyDetail {
  currentCustodyState: CustodyState;
  currentLocationId: number | null;
  overdue: boolean;
}

export async function getFileCustodyDetail(file: PersonnelFile): Promise<CustodyDetail> {
  const overdue = await isOverdue(file.organizationId, file.id, null, file.currentCustodyState as CustodyState);
  return { currentCustodyState: file.currentCustodyState as CustodyState, currentLocationId: file.currentLocationId, overdue };
}

export async function getVolumeCustodyDetail(volume: PersonnelFileVolume): Promise<CustodyDetail> {
  const overdue = await isOverdue(volume.organizationId, volume.personnelFileId, volume.id, volume.currentCustodyState as CustodyState);
  return { currentCustodyState: volume.currentCustodyState as CustodyState, currentLocationId: volume.currentLocationId, overdue };
}

export interface LastCheckoutDetail {
  destination: string | null;
  expectedReturnDate: Date | null;
  occurredAt: Date;
}

/**
 * Batched sibling of isOverdue (Phase 3H, W119, §9/§38) — the Checked-Out /
 * Overdue Personnel Files report needs the current checked_out event's own
 * destination/expectedReturnDate for every checked-out file/volume in one
 * pass, never one isOverdue() round-trip per row. Returns the most recent
 * checked_out event's own details for each (personnelFileId, volumeId)
 * target that has one — the caller compares expectedReturnDate against
 * "now" itself, so this stays a pure data-fetch, not a second overdue-
 * computation copy.
 */
export async function resolveLastCheckoutDetails(
  organizationId: number,
  personnelFileIds: number[],
): Promise<Map<string, LastCheckoutDetail>> {
  const result = new Map<string, LastCheckoutDetail>();
  if (personnelFileIds.length === 0) return result;

  const rows = await db
    .select({
      personnelFileId: personnelFileMovementsTable.personnelFileId,
      volumeId: personnelFileMovementsTable.volumeId,
      destination: personnelFileMovementsTable.destination,
      expectedReturnDate: personnelFileMovementsTable.expectedReturnDate,
      occurredAt: personnelFileMovementsTable.occurredAt,
    })
    .from(personnelFileMovementsTable)
    .where(
      and(
        eq(personnelFileMovementsTable.organizationId, organizationId),
        eq(personnelFileMovementsTable.eventType, "checked_out"),
        inArray(personnelFileMovementsTable.personnelFileId, personnelFileIds),
      ),
    )
    .orderBy(personnelFileMovementsTable.occurredAt);

  for (const row of rows) {
    const key = `${row.personnelFileId}:${row.volumeId ?? "null"}`;
    // Rows are already ordered by occurredAt ascending, so the last write
    // for a given key is always the most recent checked_out event.
    result.set(key, { destination: row.destination, expectedReturnDate: row.expectedReturnDate, occurredAt: row.occurredAt });
  }
  return result;
}
