import { describe, expect, it } from "vitest";

import { EmailService } from "../email-service";
import type { EmailMessage, IEmailProvider } from "../providers/email-provider.interface";
import { EMAIL_TEMPLATE_VALUES } from "../templates/index";

function makeFakeProvider(): IEmailProvider & { sent: EmailMessage[] } {
  return {
    sent: [],
    async send(message) {
      this.sent.push(message);
    },
  };
}

describe("EmailService", () => {
  it("renders the template to html and plain text and sends via the provider", async () => {
    const provider = makeFakeProvider();
    const service = new EmailService(provider, "Kaipu <no-reply-kaipu@updates.niway.dev>", {
      replyTo: "contacto@niway.dev",
    });
    await service.sendEmail(EMAIL_TEMPLATE_VALUES.VERIFY_EMAIL, "me@example.com", {
      locale: "en",
      verifyUrl: "https://kaipu.app/api/auth/verify-email?token=abc",
    });
    expect(provider.sent).toHaveLength(1);
    const message = provider.sent[0]!;
    expect(message.to).toBe("me@example.com");
    expect(message.from).toBe("Kaipu <no-reply-kaipu@updates.niway.dev>");
    expect(message.replyTo).toBe("contacto@niway.dev");
    expect(message.subject).toBe("Verify your Kaipu email");
    expect(message.html).toContain("token=abc");
    expect(message.text).toContain("token=abc");
  });
});
