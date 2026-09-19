import { describe, expect, it } from "vitest";

import { describeEmailFailure, EmailSendError, recipientDomain } from "../email-errors";
import { EmailService } from "../email-service";
import type { EmailMessage, IEmailProvider } from "../providers/email-provider.interface";
import { EMAIL_TEMPLATE_VALUES } from "../templates/index";

function makeFakeProvider(): IEmailProvider & { sent: EmailMessage[] } {
  return {
    name: "fake",
    sent: [],
    async send(message) {
      this.sent.push(message);
      return { id: "msg_123" };
    },
  };
}

/** A provider that rejects the way Resend does: a stable code plus prose. */
function makeRejectingProvider(code: string): IEmailProvider {
  return {
    name: "resend",
    async send(message) {
      throw new EmailSendError({
        provider: "resend",
        code,
        detail: "The updates.niway.dev domain is not verified.",
        from: message.from,
        toDomain: recipientDomain(message.to),
      });
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

  it("returns the provider's message id so a send can be traced in its dashboard", async () => {
    const service = new EmailService(makeFakeProvider(), "Kaipu <no-reply@example.com>");
    const result = await service.sendEmail(EMAIL_TEMPLATE_VALUES.VERIFY_EMAIL, "me@example.com", {
      locale: "en",
      verifyUrl: "https://kaipu.app/api/auth/verify-email?token=abc",
    });
    expect(result.id).toBe("msg_123");
  });

  it("stamps the failing template onto the error the provider could not know about", async () => {
    const service = new EmailService(
      makeRejectingProvider("invalid_from_address"),
      "Kaipu <no-reply-kaipu@updates.niway.dev>",
    );
    const err = await service
      .sendEmail(EMAIL_TEMPLATE_VALUES.VERIFY_EMAIL, "me@example.com", {
        locale: "en",
        verifyUrl: "https://kaipu.app/api/auth/verify-email?token=abc",
      })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(EmailSendError);
    const failure = (err as EmailSendError).failure;
    expect(failure.template).toBe(EMAIL_TEMPLATE_VALUES.VERIFY_EMAIL);
    expect(failure.code).toBe("invalid_from_address");
    expect(failure.toDomain).toBe("example.com");
  });
});

describe("describeEmailFailure", () => {
  // The incident this exists for: Workers logged `console.error(msg, err)` as
  // the message plus a bare stack, so the cause vanished. Everything needed to
  // diagnose must therefore be inside `summary`, which is a plain string.
  it("puts the provider code, template, sender and recipient domain in the summary", () => {
    const error = new EmailSendError({
      provider: "resend",
      code: "invalid_from_address",
      detail: "The updates.niway.dev domain is not verified.",
      from: "Kaipu <no-reply-kaipu@updates.niway.dev>",
      toDomain: "gmail.com",
      template: EMAIL_TEMPLATE_VALUES.VERIFY_EMAIL,
    });
    const { summary, fields } = describeEmailFailure(error);

    expect(summary).toContain("resend invalid_from_address");
    expect(summary).toContain(EMAIL_TEMPLATE_VALUES.VERIFY_EMAIL);
    expect(summary).toContain("not verified");
    expect(summary).toContain("updates.niway.dev");
    expect(summary).toContain("@gmail.com");
    expect(fields.code).toBe("invalid_from_address");
  });

  it("never leaks the recipient's local part", () => {
    const { summary } = describeEmailFailure(
      new EmailSendError({
        provider: "resend",
        code: "validation_error",
        detail: "rejected",
        from: "Kaipu <no-reply@example.com>",
        toDomain: recipientDomain("someone.private@gmail.com"),
      }),
    );
    expect(summary).not.toContain("someone.private");
    expect(summary).toContain("@gmail.com");
  });

  it("describes a plain Error and a non-Error without throwing", () => {
    expect(describeEmailFailure(new TypeError("boom")).summary).toBe("TypeError: boom");
    expect(describeEmailFailure("just a string").summary).toBe("just a string");
  });
});

describe("recipientDomain", () => {
  it("returns a marker rather than throwing on a malformed address", () => {
    expect(recipientDomain("no-at-sign")).toBe("unknown");
    expect(recipientDomain("trailing@")).toBe("unknown");
    expect(recipientDomain("a@b@final.com")).toBe("final.com");
  });
});
