import { createFileRoute } from "@tanstack/react-router";
import { pageHead } from "@/lib/seo";
import { LegalPage } from "@/components/legal/legal-page";

export const Route = createFileRoute("/legal/privacy-policy")({
  head: () =>
    pageHead({
      title: "Política de privacidad | Kaipu Record",
      description:
        "Qué datos trata Kaipu Record, para qué, con qué proveedores y cómo ejercer tus derechos.",
      path: "/legal/privacy-policy",
    }),
  component: () => <LegalPage document="privacy" />,
});
