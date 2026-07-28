/**
 * Provider abstraction for outbound transactional email (ADR-017): the rest
 * of the codebase depends only on this interface, never on a concrete
 * vendor SDK, so the provider can be swapped without touching call sites.
 */
export interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailProvider {
  send(params: SendEmailParams): Promise<void>;
}
