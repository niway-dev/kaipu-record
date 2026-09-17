import { Body, Container, Head, Hr, Html, Preview, Text } from "@react-email/components";

import type { EmailLocale } from "./i18n";
import { emailT } from "./i18n";

export function EmailLayout(props: {
  locale: EmailLocale;
  preview: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const t = emailT(props.locale);
  return (
    <Html lang={props.locale}>
      <Head />
      <Preview>{props.preview}</Preview>
      <Body
        style={{ margin: 0, padding: "24px", backgroundColor: "#f6f7f6", fontFamily: "sans-serif" }}
      >
        <Container
          style={{
            maxWidth: "480px",
            margin: "0 auto",
            backgroundColor: "#ffffff",
            borderRadius: "8px",
            padding: "32px",
          }}
        >
          {props.children}
          <Hr style={{ margin: "24px 0", borderColor: "#e5e5e5" }} />
          <Text style={{ fontSize: "12px", color: "#8a8a8a", margin: 0 }}>{t("footer")}</Text>
        </Container>
      </Body>
    </Html>
  );
}
