import { createFileRoute } from "@tanstack/react-router";
import { pageHead } from "@/lib/seo";
import { LegalPage } from "@/components/legal/legal-page";

export const Route = createFileRoute("/legal/terms-and-conditions")({
  staticData: { shell: "marketing" },
  head: ({ match }) =>
    pageHead({
      locale: match.context.locale,
      page: "terms-and-conditions",
      path: "/legal/terms-and-conditions",
    }),
  component: () => <LegalPage document="terms" />,
});
