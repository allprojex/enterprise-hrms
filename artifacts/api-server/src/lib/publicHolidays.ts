/**
 * Public Holiday Management (Phase 2B, W37): org-configurable holidays that
 * feed W33's server-side day calculation and overlay on W36's calendar.
 * CRUD mirrors leaveTypes.ts's archive/reactivate shape (org-scoped,
 * tenant-isolated, unique-violation translated to a typed error). Recurring
 * holidays store one row (a month/day template) and are expanded at query
 * time — never one permanent row per future year — via plain "YYYY-MM-DD"
 * string arithmetic, so nothing here is ever timezone-dependent.
 */
import { and, eq } from "drizzle-orm";
import { db, publicHolidaysTable, type PublicHoliday } from "@workspace/db";
import { recordAuditEvent } from "./auditLog";
import { isUniqueViolation } from "./dbErrors";

export class PublicHolidayNotFoundError extends Error {
  constructor() {
    super("Public holiday not found");
    this.name = "PublicHolidayNotFoundError";
  }
}

export class InvalidPublicHolidayError extends Error {}

export class DuplicatePublicHolidayError extends Error {
  constructor() {
    super("A holiday with this name already exists on this date");
    this.name = "DuplicatePublicHolidayError";
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function validateHolidayInput(fields: {
  date: string;
  recurring: boolean;
  effectiveYear?: number | null;
  observedDate?: string | null;
  scope?: string | null;
}): void {
  if (fields.scope != null && fields.scope !== "organization") {
    throw new InvalidPublicHolidayError("Only organization-scoped holidays are supported in this phase");
  }
  if (!ISO_DATE.test(fields.date)) {
    throw new InvalidPublicHolidayError("date must be in YYYY-MM-DD format");
  }
  if (fields.observedDate != null && !ISO_DATE.test(fields.observedDate)) {
    throw new InvalidPublicHolidayError("observedDate must be in YYYY-MM-DD format");
  }
  if (fields.recurring) {
    if (fields.effectiveYear != null) {
      throw new InvalidPublicHolidayError("A recurring holiday must not set effectiveYear — it applies every year");
    }
    if (fields.observedDate != null) {
      throw new InvalidPublicHolidayError("A recurring holiday must not set observedDate — only a one-off holiday can be shifted");
    }
  } else if (fields.effectiveYear == null) {
    throw new InvalidPublicHolidayError("effectiveYear is required for a one-off (non-recurring) holiday");
  } else if (fields.effectiveYear !== Number(fields.date.slice(0, 4))) {
    throw new InvalidPublicHolidayError("effectiveYear must match the year of date");
  }
}

async function findOwnHoliday(organizationId: number, holidayId: number): Promise<PublicHoliday | null> {
  const [row] = await db
    .select()
    .from(publicHolidaysTable)
    .where(and(eq(publicHolidaysTable.id, holidayId), eq(publicHolidaysTable.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

export async function getPublicHolidayById(organizationId: number, holidayId: number): Promise<PublicHoliday | null> {
  return findOwnHoliday(organizationId, holidayId);
}

/** Active by default; `year` also matches every recurring holiday, since those apply every year regardless of their template's stored year. */
export async function listPublicHolidays(
  organizationId: number,
  params?: { year?: number; includeInactive?: boolean },
): Promise<PublicHoliday[]> {
  const conditions = [eq(publicHolidaysTable.organizationId, organizationId)];
  if (!params?.includeInactive) conditions.push(eq(publicHolidaysTable.status, "active"));

  const rows = await db.select().from(publicHolidaysTable).where(and(...conditions));
  const filtered =
    params?.year != null
      ? rows.filter((h) => h.recurring || h.effectiveYear === params.year || Number(h.date.slice(0, 4)) === params.year)
      : rows;

  return filtered.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export async function createPublicHoliday(params: {
  organizationId: number;
  name: string;
  date: string;
  recurring: boolean;
  observedDate?: string | null;
  effectiveYear?: number | null;
  description?: string | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<PublicHoliday> {
  validateHolidayInput(params);

  try {
    const [holiday] = await db
      .insert(publicHolidaysTable)
      .values({
        organizationId: params.organizationId,
        name: params.name,
        date: params.date,
        scope: "organization",
        recurring: params.recurring,
        observedDate: params.recurring ? null : (params.observedDate ?? null),
        effectiveYear: params.recurring ? null : params.effectiveYear,
        description: params.description ?? null,
      })
      .returning();

    await recordAuditEvent({
      actorApplicationUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
      organizationId: params.organizationId,
      eventType: "public_holiday.created",
      targetType: "public_holiday",
      targetId: String(holiday.id),
      afterState: { name: holiday.name, date: holiday.date, recurring: holiday.recurring },
    });

    return holiday;
  } catch (err) {
    if (isUniqueViolation(err)) throw new DuplicatePublicHolidayError();
    throw err;
  }
}

export async function updatePublicHoliday(params: {
  organizationId: number;
  holidayId: number;
  name?: string;
  date?: string;
  recurring?: boolean;
  observedDate?: string | null;
  effectiveYear?: number | null;
  description?: string | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<PublicHoliday> {
  const before = await findOwnHoliday(params.organizationId, params.holidayId);
  if (!before) throw new PublicHolidayNotFoundError();

  const recurring = params.recurring ?? before.recurring;
  const merged = {
    date: params.date ?? before.date,
    recurring,
    effectiveYear: recurring ? null : (params.effectiveYear !== undefined ? params.effectiveYear : before.effectiveYear),
    observedDate: recurring ? null : (params.observedDate !== undefined ? params.observedDate : before.observedDate),
  };
  validateHolidayInput(merged);

  const patch: Record<string, unknown> = { effectiveYear: merged.effectiveYear, observedDate: merged.observedDate };
  if (params.name !== undefined) patch.name = params.name;
  if (params.date !== undefined) patch.date = params.date;
  if (params.recurring !== undefined) patch.recurring = params.recurring;
  if (params.description !== undefined) patch.description = params.description;

  try {
    const [updated] = await db.update(publicHolidaysTable).set(patch).where(eq(publicHolidaysTable.id, params.holidayId)).returning();

    await recordAuditEvent({
      actorApplicationUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
      organizationId: params.organizationId,
      eventType: "public_holiday.updated",
      targetType: "public_holiday",
      targetId: String(params.holidayId),
      beforeState: { name: before.name, date: before.date, recurring: before.recurring },
      afterState: { name: updated.name, date: updated.date, recurring: updated.recurring },
    });

    return updated;
  } catch (err) {
    if (isUniqueViolation(err)) throw new DuplicatePublicHolidayError();
    throw err;
  }
}

async function setHolidayStatus(params: {
  organizationId: number;
  holidayId: number;
  status: "active" | "inactive";
  eventType: string;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<PublicHoliday> {
  const before = await findOwnHoliday(params.organizationId, params.holidayId);
  if (!before) throw new PublicHolidayNotFoundError();

  const [updated] = await db
    .update(publicHolidaysTable)
    .set({ status: params.status })
    .where(eq(publicHolidaysTable.id, params.holidayId))
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: params.eventType,
    targetType: "public_holiday",
    targetId: String(params.holidayId),
    beforeState: { status: before.status },
    afterState: { status: updated.status },
  });

  return updated;
}

export const deactivatePublicHoliday = (params: {
  organizationId: number;
  holidayId: number;
  actorApplicationUserId: number;
  actorMembershipId: number;
}) => setHolidayStatus({ ...params, status: "inactive", eventType: "public_holiday.deactivated" });

export const reactivatePublicHoliday = (params: {
  organizationId: number;
  holidayId: number;
  actorApplicationUserId: number;
  actorMembershipId: number;
}) => setHolidayStatus({ ...params, status: "active", eventType: "public_holiday.reactivated" });

/**
 * Hard delete — safe because no FK anywhere references a public_holidays
 * row (unlike leave_types/leave_policies, which leave_requests does
 * reference). A past request's daysRequested was already computed and
 * stored at submission time (W33); deleting a holiday can never
 * reinterpret it, since nothing reads holidays retroactively.
 */
export async function deletePublicHoliday(params: {
  organizationId: number;
  holidayId: number;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<void> {
  const before = await findOwnHoliday(params.organizationId, params.holidayId);
  if (!before) throw new PublicHolidayNotFoundError();

  await db.delete(publicHolidaysTable).where(eq(publicHolidaysTable.id, params.holidayId));

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "public_holiday.deleted",
    targetType: "public_holiday",
    targetId: String(params.holidayId),
    beforeState: { name: before.name, date: before.date, recurring: before.recurring },
  });
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Deterministic year-aware expansion of a recurring holiday's month/day template — Feb 29 falls back to Feb 28 in a non-leap year. Pure string arithmetic; never constructs a Date object, so no UTC conversion can shift the result. */
function occurrenceForYear(templateDate: string, year: number): string {
  const [, monthStr, dayStr] = templateDate.split("-");
  let day = Number(dayStr);
  if (Number(monthStr) === 2 && day === 29 && !isLeapYear(year)) day = 28;
  return `${year}-${monthStr}-${String(day).padStart(2, "0")}`;
}

function yearsInRange(from: string, to: string): number[] {
  const fromYear = Number(from.slice(0, 4));
  const toYear = Number(to.slice(0, 4));
  const years: number[] = [];
  for (let year = fromYear; year <= toYear; year++) years.push(year);
  return years;
}

export interface HolidayOccurrence {
  id: number;
  name: string;
  date: string;
}

/**
 * Every active holiday's concrete occurrence(s) within [from, to] — a
 * recurring holiday's template is expanded per overlapping year, a one-off
 * holiday's `observedDate` (if set) is used in place of `date`. Shared by
 * the day-calculation integration and W36's calendar overlay, so both stay
 * consistent by construction rather than two separate implementations.
 */
export async function listHolidayOccurrencesInRange(organizationId: number, from: string, to: string): Promise<HolidayOccurrence[]> {
  const holidays = await db
    .select()
    .from(publicHolidaysTable)
    .where(and(eq(publicHolidaysTable.organizationId, organizationId), eq(publicHolidaysTable.status, "active")));

  const occurrences: HolidayOccurrence[] = [];
  for (const holiday of holidays) {
    if (holiday.recurring) {
      for (const year of yearsInRange(from, to)) {
        const occurrence = occurrenceForYear(holiday.date, year);
        if (occurrence >= from && occurrence <= to) {
          occurrences.push({ id: holiday.id, name: holiday.name, date: occurrence });
        }
      }
    } else {
      const effective = holiday.observedDate ?? holiday.date;
      if (effective >= from && effective <= to) {
        occurrences.push({ id: holiday.id, name: holiday.name, date: effective });
      }
    }
  }

  return occurrences.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** The exact `ReadonlySet<string>` shape W33's calculateLeaveDays' publicHolidayDates parameter expects. */
export async function resolveHolidayDatesInRange(organizationId: number, from: string, to: string): Promise<Set<string>> {
  const occurrences = await listHolidayOccurrencesInRange(organizationId, from, to);
  return new Set(occurrences.map((o) => o.date));
}
