/**
 * Raised when a request changed between the moment a decision was checked and
 * the moment it was written — another approver decided it, the employee
 * withdrew it, or it was re-confirmed. Every WS-13 transition writes with a
 * compare-and-set WHERE clause (the row must still be in the exact state that
 * was read), and throws this inside the transaction when nothing matched, so
 * the transition's event row is rolled back with it and nothing is recorded
 * twice. The route answers 409: reloading and trying again is the resolution.
 */
export class RequestChangedConcurrentlyError extends Error {
  constructor() {
    super("This request was changed by someone else while you were acting on it. Reload it and try again.");
    this.name = "RequestChangedConcurrentlyError";
  }
}
