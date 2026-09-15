import { createFileRoute } from "@tanstack/react-router";
import { pageHead } from "@/lib/seo";
import { LegalPage } from "@/components/legal/legal-page";

export const Route = createFileRoute("/legal/cloud-terms")({
  head: () =>
    pageHead({
      title: "Condiciones de Cloud | Kaipu Record",
      description:
        "Almacenamiento gratuito promocional, límites, uso aceptable y cambios de Kaipu Cloud.",
      path: "/legal/cloud-terms",
    }),
  component: () => <LegalPage document="cloud" />,
});
