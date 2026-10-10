import type { AccountDeletionNotifier } from "@kaipu/application";
import { describeEmailFailure, EMAIL_TEMPLATE_VALUES, type EmailService } from "@kaipu/infra-email";
import { toEmailLocale, tryGetEmail, webUrl } from "./email";

/** "17 October 2026" / "17 de octubre de 2026", always in UTC so it matches `scheduledAt`. */
export function formatDeletionDate(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(toEmailLocale(locale) === "es" ? "es" : "en-GB", {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(date);
}

/**
 * Account deletion emails through the infra-email (Resend) pattern. When RESEND_API_KEY is not
 * set the email is skipped and logged; the deletion itself goes ahead. Send failures are logged
 * and rethrown — the use cases treat them as best effort.
 */
export function makeAccountDeletionNotifier(
  getEmail: () => EmailService | null = tryGetEmail,
): AccountDeletionNotifier {
  return {
    async deletionScheduled(to, scheduledAt) {
      const email = getEmail();
      if (!email) {
        console.error("account deletion email skipped: transactional email is disabled");
        return;
      }
      const locale = toEmailLocale(to.locale);
      try {
        await email.sendEmail(EMAIL_TEMPLATE_VALUES.ACCOUNT_DELETION_SCHEDULED, to.email, {
          locale,
          dateLabel: formatDeletionDate(scheduledAt, locale),
          signInUrl: `${webUrl()}/auth/login`,
        });
      } catch (err) {
        const { summary, fields } = describeEmailFailure(err);
        console.error(`failed to send the account deletion email — ${summary}`, fields);
        throw err;
      }
    },
    async accountDeleted(to) {
      const email = getEmail();
      if (!email) {
        console.error("account deleted email skipped: transactional email is disabled");
        return;
      }
      try {
        await email.sendEmail(EMAIL_TEMPLATE_VALUES.ACCOUNT_DELETED, to.email, {
          locale: toEmailLocale(to.locale),
        });
      } catch (err) {
        const { summary, fields } = describeEmailFailure(err);
        console.error(`failed to send the account deleted email — ${summary}`, fields);
        throw err;
      }
    },
  };
}
