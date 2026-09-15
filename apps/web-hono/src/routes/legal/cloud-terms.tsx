import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/legal/legal-page";

export const Route = createFileRoute("/legal/cloud-terms")({
  head: () => ({ meta: [{ title: "Cloud Terms | Kaipu Record" }] }),
  component: () => <LegalPage document="cloud" />,
});
