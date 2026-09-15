import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/legal/legal-page";

export const Route = createFileRoute("/legal/cookies")({
  head: () => ({ meta: [{ title: "Cookies | Kaipu Record" }] }),
  component: () => <LegalPage document="cookies" />,
});
