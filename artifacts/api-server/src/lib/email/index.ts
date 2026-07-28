import { ResendEmailProvider } from "./resendProvider";
import type { EmailProvider } from "./EmailProvider";

export type { EmailProvider, SendEmailParams } from "./EmailProvider";

export class EmailNotConfiguredError extends Error {
  constructor() {
    super("RESEND_API_KEY and EMAIL_FROM_ADDRESS must both be set to send email.");
    this.name = "EmailNotConfiguredError";
  }
}

let provider: EmailProvider | null = null;

/**
 * Lazily constructed so importing this module (and everything that imports
 * it) doesn't require RESEND_API_KEY at server boot -- only code paths that
 * actually send email need it configured.
 */
export function getEmailProvider(): EmailProvider {
  if (!provider) {
    const apiKey = process.env.RESEND_API_KEY;
    const fromAddress = process.env.EMAIL_FROM_ADDRESS;
    if (!apiKey || !fromAddress) {
      throw new EmailNotConfiguredError();
    }
    provider = new ResendEmailProvider(apiKey, fromAddress);
  }
  return provider;
}
