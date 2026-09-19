import { createFileRoute } from "@tanstack/react-router";
import { pageHead } from "@/lib/seo";
import { LegalPage } from "@/components/legal/legal-page";

export const Route = createFileRoute("/legal/cloud-terms")({
  staticData: { shell: "marketing" },
  head: ({ match }) =>
    pageHead({ locale: match.context.locale, page: "cloud-terms", path: "/legal/cloud-terms" }),
  component: () => <LegalPage document="cloud" />,
});
