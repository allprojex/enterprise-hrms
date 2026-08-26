/**
 * WS-6 (Scheduled Jobs / Notifications Foundation, §21-22) — resolves an
 * organization's timezone and converts an organization-local wall-clock time
 * into the UTC instant the scheduler actually persists and polls on.
 *
 * The frozen architecture left this undefined, so it was resolved carefully
 * against actual repository state rather than assumed. Verified before
 * writing this: `organizationConfig.ts`'s `general` namespace already has a
 * `timezone: z.string().optional()` field, but it is an unvalidated free
 * string and nothing anywhere reads it today — extending its validation is
 * out of this file's scope (that schema belongs to a foundation workstream
 * this one doesn't reopen); instead this module treats whatever string is
 * stored there as untrusted input and validates it itself, on every read,
 * failing safe to UTC rather than trusting a stale or malformed value.
 *
 * No timezone-conversion library exists on the backend (`date-fns`/`luxon`/
 * `moment`/`dayjs` are absent from every backend workspace's package.json —
 * confirmed, not assumed). None is added here: Node 20's built-in `Intl`
 * ships full ICU data and already resolves arbitrary IANA timezones,
 * including their historical and future DST transitions, with zero new
 * dependency on a platform hardened in WS-1. `Intl.supportedValuesOf` is
 * what validates a timezone string is real.
 *
 * §22 of the brief: "do not hard-code Africa/Accra into shared scheduling
 * logic." Nothing below names any specific timezone — "Africa/Accra" (or
 * any other zone) appears only in this file's own comments and its test
 * file, as one example zone among several used to prove the general
 * mechanism, exactly the same way the test file also exercises a
 * DST-observing zone this platform's current Ghana-based customers do not
 * use, to prove the mechanism is not accidentally GMT-only.
 */

import { getNamespaceConfig } from "../services/organizationConfig";

export const DEFAULT_ORGANIZATION_TIMEZONE = "UTC";

let supportedTimezones: ReadonlySet<string> | null = null;

/** True if `timezone` is a real IANA zone identifier Node's ICU data recognizes. */
export function isValidTimezone(timezone: string): boolean {
  if (typeof Intl.supportedValuesOf === "function") {
    if (!supportedTimezones) {
      supportedTimezones = new Set(Intl.supportedValuesOf("timeZone"));
    }
    if (supportedTimezones.has(timezone)) return true;
  }
  // Fall back to asking Intl to actually construct a formatter for the zone
  // — covers the (rare, older-runtime) case where supportedValuesOf is
  // unavailable, and catches any zone supportedValuesOf's list might miss.
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The organization's configured timezone, or UTC when unset or invalid.
 * Never throws — a malformed value in `organization_settings` must degrade
 * to a safe, well-defined default, not break every scheduling call for that
 * organization.
 */
export async function resolveOrganizationTimezone(organizationId: number): Promise<string> {
  const general = await getNamespaceConfig(organizationId, "general");
  const configured = (general.data as { timezone?: unknown }).timezone;
  if (typeof configured === "string" && configured.length > 0 && isValidTimezone(configured)) {
    return configured;
  }
  return DEFAULT_ORGANIZATION_TIMEZONE;
}

/** The UTC offset (minutes east of UTC) `timezone` observes at instant `at`. */
function offsetMinutesAt(timezone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  // The wall-clock reading of `at` as seen in `timezone`, reinterpreted as if
  // it were itself a UTC instant. The gap between that and `at` is exactly
  // the zone's offset at that instant — the standard, dependency-free
  // technique for extracting an Intl timezone's offset.
  const asIfUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asIfUtc - at.getTime()) / 60000);
}

export class InvalidLocalDateTimeError extends Error {
  constructor(input: string) {
    super(`"${input}" is not a valid local date-time (expected YYYY-MM-DDTHH:mm or YYYY-MM-DDTHH:mm:ss)`);
    this.name = "InvalidLocalDateTimeError";
  }
}

/**
 * Converts an organization-local wall-clock time (no offset, e.g.
 * "2026-09-01T09:00") into the UTC instant it represents in `timezone`.
 *
 * Resolves the offset in two passes: first estimate the offset as of the
 * naive UTC interpretation of the input, then re-resolve the offset at that
 * candidate instant and adjust once more. Two passes are sufficient because
 * a timezone's offset changes at most once across any single local clock
 * reading (DST transitions move the clock by at most a couple of hours, far
 * smaller than the maximum possible offset error a single pass could leave).
 * A local time that does not exist (skipped forward over a DST "spring
 * forward" gap) resolves to the instant implied by the offset on the later
 * side of the gap — deterministic, not an error, since which side to prefer
 * has no universally correct answer and this primitive must never throw for
 * an organization simply because of how its local clock moved that day.
 */
export function localDateTimeToUtc(timezone: string, localDateTime: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(localDateTime);
  if (!match) throw new InvalidLocalDateTimeError(localDateTime);
  const [, y, mo, d, h, mi, s] = match;
  const naiveUtcMs = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s ?? "0"));

  const firstOffset = offsetMinutesAt(timezone, new Date(naiveUtcMs));
  const candidateMs = naiveUtcMs - firstOffset * 60000;
  const secondOffset = offsetMinutesAt(timezone, new Date(candidateMs));
  return new Date(naiveUtcMs - secondOffset * 60000);
}
