import { createFileRoute } from "@tanstack/react-router";
import { pageHead } from "@/lib/seo";
import { LegalPage } from "@/components/legal/legal-page";

export const Route = createFileRoute("/legal/privacy-policy")({
  staticData: { shell: "marketing" },
  head: ({ match }) =>
    pageHead({
      locale: match.context.locale,
      page: "privacy-policy",
      path: "/legal/privacy-policy",
    }),
  component: () => <LegalPage document="privacy" />,
});
