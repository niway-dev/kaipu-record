import { createFileRoute } from "@tanstack/react-router";
import { pageHead } from "@/lib/seo";
import { LegalPage } from "@/components/legal/legal-page";

export const Route = createFileRoute("/legal/cookies")({
  staticData: { shell: "marketing" },
  head: ({ match }) =>
    pageHead({ locale: match.context.locale, page: "cookies", path: "/legal/cookies" }),
  component: () => <LegalPage document="cookies" />,
});
