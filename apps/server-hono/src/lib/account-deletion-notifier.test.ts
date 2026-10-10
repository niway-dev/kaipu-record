import type { EmailService } from "@kaipu/infra-email";
import { describe, expect, it, vi } from "vitest";

vi.mock("../env", () => ({ env: { PUBLIC_WEB_URL: "https://kaipu.test/" } }));

const { formatDeletionDate, makeAccountDeletionNotifier } =
  await import("./account-deletion-notifier");

const AT = new Date("2026-10-17T12:00:00Z");

describe("account deletion notifier", () => {
  it("formats the date per locale in UTC", () => {
    expect(formatDeletionDate(AT, "en")).toBe("17 October 2026");
    expect(formatDeletionDate(AT, "es")).toBe("17 de octubre de 2026");
  });

  it("sends the scheduled email with the date and the sign-in link", async () => {
    const sendEmail = vi.fn(async () => ({ id: "m1" }));
    const notifier = makeAccountDeletionNotifier(() => ({ sendEmail }) as unknown as EmailService);
    await notifier.deletionScheduled({ email: "a@x.dev", locale: "es" }, AT);
    expect(sendEmail).toHaveBeenCalledWith("ACCOUNT_DELETION_SCHEDULED", "a@x.dev", {
      locale: "es",
      dateLabel: "17 de octubre de 2026",
      signInUrl: "https://kaipu.test/auth/login",
    });
    await notifier.accountDeleted({ email: "a@x.dev", locale: "fr" });
    expect(sendEmail).toHaveBeenLastCalledWith("ACCOUNT_DELETED", "a@x.dev", { locale: "en" });
  });

  it("skips and logs when email is not configured", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const notifier = makeAccountDeletionNotifier(() => null);
    await expect(notifier.deletionScheduled({ email: "a@x.dev", locale: "en" }, AT)).resolves.toBe(
      undefined,
    );
    await expect(notifier.accountDeleted({ email: "a@x.dev", locale: "en" })).resolves.toBe(
      undefined,
    );
    expect(spy).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(spy.mock.calls)).not.toContain("a@x.dev");
    spy.mockRestore();
  });
});
