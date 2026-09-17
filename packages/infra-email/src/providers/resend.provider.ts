import { Resend } from "resend";

import type { EmailMessage, IEmailProvider } from "./email-provider.interface";

export class ResendEmailProvider implements IEmailProvider {
  private readonly client: Resend;

  constructor(apiKey: string) {
    this.client = new Resend(apiKey);
  }

  async send(message: EmailMessage): Promise<void> {
    const { error } = await this.client.emails.send({
      from: message.from,
      to: message.to,
      replyTo: message.replyTo,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
    if (error) {
      throw new Error(`Resend error: ${error.message}`);
    }
  }
}
