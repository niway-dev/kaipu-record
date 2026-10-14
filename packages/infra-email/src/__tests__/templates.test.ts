import { render } from "@react-email/render";
import { describe, expect, it } from "vitest";

import { EMAIL_TEMPLATE_VALUES, EmailTemplateMap } from "../templates/index";

describe("email templates", () => {
  it("renders the verification email in both locales with the link", async () => {
    for (const locale of ["en", "es"] as const) {
      const entry = EmailTemplateMap[EMAIL_TEMPLATE_VALUES.VERIFY_EMAIL];
      const data = { locale, verifyUrl: "https://kaipu.app/api/auth/verify-email?token=abc" };
      expect(entry.subject(data)).toBeTruthy();
      const html = await render(entry.component(data));
      const text = await render(entry.component(data), { plainText: true });
      expect(html).toContain("https://kaipu.app/api/auth/verify-email?token=abc");
      expect(text).toContain("https://kaipu.app/api/auth/verify-email?token=abc");
    }
  });

  it("renders the reset email with the one-hour link", async () => {
    const entry = EmailTemplateMap[EMAIL_TEMPLATE_VALUES.RESET_PASSWORD];
    const data = {
      locale: "en" as const,
      resetUrl: "https://kaipu.app/auth/reset-password?token=xyz",
    };
    const html = await render(entry.component(data));
    expect(html).toContain("https://kaipu.app/auth/reset-password?token=xyz");
    expect(entry.subject(data)).toContain("password");
  });

  it("renders the expansion-approved email with the capacity", async () => {
    const entry = EmailTemplateMap[EMAIL_TEMPLATE_VALUES.EXPANSION_APPROVED];
    const data = { locale: "es" as const, capacityLabel: "1 GB", openUrl: "https://kaipu.app" };
    expect(entry.subject(data)).toContain("1 GB");
    const html = await render(entry.component(data));
    expect(html).toContain("1 GB");
  });

  it("renders the deletion-scheduled email with the date and the sign-in link, both locales", async () => {
    const entry = EmailTemplateMap[EMAIL_TEMPLATE_VALUES.ACCOUNT_DELETION_SCHEDULED];
    for (const locale of ["en", "es"] as const) {
      const data = { locale, dateLabel: "17 Oct 2026", signInUrl: "https://kaipu.app/auth/login" };
      expect(entry.subject(data)).toContain("17 Oct 2026");
      const text = await render(entry.component(data), { plainText: true });
      expect(text).toContain("17 Oct 2026");
      expect(text).toContain("https://kaipu.app/auth/login");
    }
  });

  it("renders the account-deleted email", async () => {
    const entry = EmailTemplateMap[EMAIL_TEMPLATE_VALUES.ACCOUNT_DELETED];
    const data = { locale: "en" as const };
    expect(entry.subject(data)).toBe("Your Kaipu account was deleted");
    expect(await render(entry.component(data), { plainText: true })).toContain(
      "Your account was deleted",
    );
  });
});
