import { Button, Heading, Text } from "@react-email/components";

import type { EmailLocale } from "./i18n";
import { emailT } from "./i18n";
import { EmailLayout } from "./layout";

export interface ExpansionApprovedData {
  locale: EmailLocale;
  capacityLabel: string;
  openUrl: string;
}

const button = {
  backgroundColor: "#f6055c",
  borderRadius: "6px",
  color: "#ffffff",
  padding: "12px 20px",
  fontSize: "14px",
  textDecoration: "none",
} as const;

export function ExpansionApprovedEmail(data: ExpansionApprovedData): React.JSX.Element {
  const t = emailT(data.locale);
  return (
    <EmailLayout locale={data.locale} preview={t("approvedPreview")}>
      <Heading as="h1" style={{ fontSize: "20px", margin: "0 0 12px" }}>
        {t("approvedHeading")}
      </Heading>
      <Text style={{ fontSize: "14px", lineHeight: "22px" }}>
        {t("approvedBody", { capacity: data.capacityLabel })}
      </Text>
      <Button href={data.openUrl} style={button}>
        {t("approvedButton")}
      </Button>
    </EmailLayout>
  );
}
