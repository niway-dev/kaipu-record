import { Button, Heading, Text } from "@react-email/components";

import type { EmailLocale } from "./i18n";
import { emailT } from "./i18n";
import { EmailLayout } from "./layout";

export interface AccountDeletionScheduledData {
  locale: EmailLocale;
  /** Already formatted for the locale, e.g. "October 17, 2026". */
  dateLabel: string;
  signInUrl: string;
}

const button = {
  backgroundColor: "#f6055c",
  borderRadius: "6px",
  color: "#ffffff",
  padding: "12px 20px",
  fontSize: "14px",
  textDecoration: "none",
} as const;

export function AccountDeletionScheduledEmail(
  data: AccountDeletionScheduledData,
): React.JSX.Element {
  const t = emailT(data.locale);
  return (
    <EmailLayout
      locale={data.locale}
      preview={t("deletionScheduledPreview", { date: data.dateLabel })}
    >
      <Heading as="h1" style={{ fontSize: "20px", margin: "0 0 12px" }}>
        {t("deletionScheduledHeading")}
      </Heading>
      <Text style={{ fontSize: "14px", lineHeight: "22px" }}>
        {t("deletionScheduledBody", { date: data.dateLabel })}
      </Text>
      <Button href={data.signInUrl} style={button}>
        {t("deletionScheduledButton")}
      </Button>
      <Text style={{ fontSize: "12px", color: "#8a8a8a" }}>{t("deletionScheduledLocal")}</Text>
    </EmailLayout>
  );
}
