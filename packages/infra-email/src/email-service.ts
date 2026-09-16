import { render } from "@react-email/render";

import type { EmailMessage, IEmailProvider } from "./providers/email-provider.interface";
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
  ): Promise<void> {
    const entry = EmailTemplateMap[template];
    const subject = entry.subject(data);
    const [html, text] = await Promise.all([
      render(entry.component(data)),
      render(entry.component(data), { plainText: true }),
    ]);
    const message: EmailMessage = { to, from: this.from, subject, html, text };
    if (this.options.replyTo) message.replyTo = this.options.replyTo;
    await this.provider.send(message);
  }
}
