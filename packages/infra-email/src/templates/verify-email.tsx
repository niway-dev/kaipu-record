import { Button, Heading, Text } from "@react-email/components";

import type { EmailLocale } from "./i18n";
import { emailT } from "./i18n";
import { EmailLayout } from "./layout";

export interface VerifyEmailData {
  locale: EmailLocale;
  verifyUrl: string;
}

const button = {
  backgroundColor: "#f6055c",
  borderRadius: "6px",
  color: "#ffffff",
  padding: "12px 20px",
  fontSize: "14px",
  textDecoration: "none",
} as const;

export function VerifyEmail(data: VerifyEmailData): React.JSX.Element {
  const t = emailT(data.locale);
  return (
    <EmailLayout locale={data.locale} preview={t("verifyPreview")}>
      <Heading as="h1" style={{ fontSize: "20px", margin: "0 0 12px" }}>
        {t("verifyHeading")}
      </Heading>
      <Text style={{ fontSize: "14px", lineHeight: "22px" }}>{t("verifyBody")}</Text>
      <Button href={data.verifyUrl} style={button}>
        {t("verifyButton")}
      </Button>
      <Text style={{ fontSize: "12px", color: "#8a8a8a" }}>{data.verifyUrl}</Text>
      <Text style={{ fontSize: "12px", color: "#8a8a8a" }}>{t("verifyIgnore")}</Text>
    </EmailLayout>
  );
}
