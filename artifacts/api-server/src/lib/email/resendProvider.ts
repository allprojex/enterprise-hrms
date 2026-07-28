import { Resend } from "resend";
import type { EmailProvider, SendEmailParams } from "./EmailProvider";

export class ResendEmailProvider implements EmailProvider {
  private readonly client: Resend;

  constructor(
    apiKey: string,
    private readonly fromAddress: string,
  ) {
    this.client = new Resend(apiKey);
  }

  async send(params: SendEmailParams): Promise<void> {
    const result = await this.client.emails.send({
      from: this.fromAddress,
      to: params.to,
      subject: params.subject,
      html: params.html,
      text: params.text,
    });

    if (result.error) {
      throw new Error(`Resend email delivery failed: ${result.error.message}`);
    }
  }
}
