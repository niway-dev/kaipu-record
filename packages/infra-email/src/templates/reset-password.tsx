import { Button, Heading, Text } from "@react-email/components";

import type { EmailLocale } from "./i18n";
import { emailT } from "./i18n";
import { EmailLayout } from "./layout";

export interface ResetPasswordData {
  locale: EmailLocale;
  resetUrl: string;
}

const button = {
  backgroundColor: "#f6055c",
  borderRadius: "6px",
  color: "#ffffff",
  padding: "12px 20px",
  fontSize: "14px",
  textDecoration: "none",
} as const;

export function ResetPasswordEmail(data: ResetPasswordData): React.JSX.Element {
  const t = emailT(data.locale);
  return (
    <EmailLayout locale={data.locale} preview={t("resetPreview")}>
      <Heading as="h1" style={{ fontSize: "20px", margin: "0 0 12px" }}>
        {t("resetHeading")}
      </Heading>
      <Text style={{ fontSize: "14px", lineHeight: "22px" }}>{t("resetBody")}</Text>
      <Button href={data.resetUrl} style={button}>
        {t("resetButton")}
      </Button>
      <Text style={{ fontSize: "12px", color: "#8a8a8a" }}>{data.resetUrl}</Text>
      <Text style={{ fontSize: "12px", color: "#8a8a8a" }}>{t("resetIgnore")}</Text>
    </EmailLayout>
  );
}
