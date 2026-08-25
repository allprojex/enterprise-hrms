/**
 * WS-3 (Audit & Sensitive-Data Security Hardening, Owner Decision #23) —
 * the one shared sensitive-value masking primitive for this platform.
 * `maskAccountNumber` already existed, proven, in payrollPaymentBatches.ts
 * (used to mask account numbers in the payment-batch CSV export) — moved
 * here so it has one home instead of being redefined, and reused directly
 * (not reimplemented) by payrollSensitiveRecords.ts's masked-by-default
 * banking/statutory GET responses.
 */

/** "1234567890123" -> "*********0123" (keeps the last 4 characters; masks a short value entirely). */
export function maskAccountNumber(accountNumber: string): string {
  if (accountNumber.length <= 4) return "*".repeat(accountNumber.length);
  return "*".repeat(accountNumber.length - 4) + accountNumber.slice(-4);
}

/**
 * Same masking shape as maskAccountNumber, under a name that reads
 * correctly at SSNIT-number/TIN call sites — identical behavior (kept as a
 * separate export, not just an alias, so each call site's intent is clear
 * from its own import), not a second implementation.
 */
export function maskIdentifier(value: string): string {
  return maskAccountNumber(value);
}
