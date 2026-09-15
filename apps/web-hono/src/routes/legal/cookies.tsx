import { createFileRoute } from "@tanstack/react-router";
import { pageHead } from "@/lib/seo";
import { LegalPage } from "@/components/legal/legal-page";

export const Route = createFileRoute("/legal/cookies")({
  head: () =>
    pageHead({
      title: "Cookies y almacenamiento local | Kaipu Record",
      description: "Cookies de sesión y preferencias que usa Kaipu Record, y cómo gestionarlas.",
      path: "/legal/cookies",
    }),
  component: () => <LegalPage document="cookies" />,
});
