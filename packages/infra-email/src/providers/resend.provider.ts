import { Resend } from "resend";

import { EmailSendError, recipientDomain } from "../email-errors";
import type { EmailMessage, EmailSendResult, IEmailProvider } from "./email-provider.interface";

export class ResendEmailProvider implements IEmailProvider {
  readonly name = "resend";
  private readonly client: Resend;

  constructor(apiKey: string) {
    this.client = new Resend(apiKey);
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    const { data, error } = await this.client.emails.send({
      from: message.from,
      to: message.to,
      replyTo: message.replyTo,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
    if (error) {
      // Resend's `name` is a stable code — `invalid_from_address`,
      // `missing_api_key`, `invalid_api_Key`, `rate_limit_exceeded`, … — and is
      // the only part of the response worth branching on. It was previously
      // discarded in favour of the prose message alone.
      throw new EmailSendError({
        provider: this.name,
        code: error.name ?? "unknown",
        detail: error.message,
        from: message.from,
        toDomain: recipientDomain(message.to),
      });
    }
    return { id: data?.id };
  }
}
