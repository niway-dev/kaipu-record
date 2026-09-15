import { createFileRoute } from "@tanstack/react-router";
import { pageHead } from "@/lib/seo";
import { LegalPage } from "@/components/legal/legal-page";

export const Route = createFileRoute("/legal/terms-and-conditions")({
  head: () =>
    pageHead({
      title: "Términos y condiciones | Kaipu Record",
      description:
        "Condiciones de uso de Kaipu Record y sus servicios Cloud, operados por Niway S.A.C.",
      path: "/legal/terms-and-conditions",
    }),
  component: () => <LegalPage document="terms" />,
});
