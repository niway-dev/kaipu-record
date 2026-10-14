import { Heading, Text } from "@react-email/components";

import type { EmailLocale } from "./i18n";
import { emailT } from "./i18n";
import { EmailLayout } from "./layout";

export interface AccountDeletedData {
  locale: EmailLocale;
}

export function AccountDeletedEmail(data: AccountDeletedData): React.JSX.Element {
  const t = emailT(data.locale);
  return (
    <EmailLayout locale={data.locale} preview={t("deletedPreview")}>
      <Heading as="h1" style={{ fontSize: "20px", margin: "0 0 12px" }}>
        {t("deletedHeading")}
      </Heading>
      <Text style={{ fontSize: "14px", lineHeight: "22px" }}>{t("deletedBody")}</Text>
      <Text style={{ fontSize: "12px", color: "#8a8a8a" }}>{t("deletionScheduledLocal")}</Text>
    </EmailLayout>
  );
}
