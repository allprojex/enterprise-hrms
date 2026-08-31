/**
 * WS-15 P3 — reporting errors with no dependencies of their own.
 *
 * Kept in their own module so `lib/reporting.ts` can surface them without
 * importing the adapter layer, which pulls in all eight module reporting
 * services. That separation is what lets the adapter graph load lazily.
 */

/** A parameter the report genuinely requires was missing or malformed. */
export class ReportParameterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReportParameterError";
  }
}
