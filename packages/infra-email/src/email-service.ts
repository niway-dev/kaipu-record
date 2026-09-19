import { render } from "@react-email/render";

import { EmailSendError } from "./email-errors";
import type {
  EmailMessage,
  EmailSendResult,
  IEmailProvider,
} from "./providers/email-provider.interface";
import { EmailTemplateMap } from "./templates/index";
import type { EmailTemplate, TemplateDataMap } from "./templates/types";

export class EmailService {
  constructor(
    private readonly provider: IEmailProvider,
    private readonly from: string,
    private readonly options: { replyTo?: string } = {},
  ) {}

  async sendEmail<T extends EmailTemplate>(
    template: T,
    to: string,
    data: TemplateDataMap[T],
  ): Promise<EmailSendResult> {
    const entry = EmailTemplateMap[template];
    const subject = entry.subject(data);
    const [html, text] = await Promise.all([
      render(entry.component(data)),
      render(entry.component(data), { plainText: true }),
    ]);
    const message: EmailMessage = { to, from: this.from, subject, html, text };
    if (this.options.replyTo) message.replyTo = this.options.replyTo;
    try {
      return await this.provider.send(message);
    } catch (err) {
      // The provider has no idea which template it was carrying; without this
      // a failure log cannot say whether verification or password reset broke.
      throw err instanceof EmailSendError ? err.withTemplate(template) : err;
    }
  }
}
