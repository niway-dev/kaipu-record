import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/legal/legal-page";

export const Route = createFileRoute("/legal/privacy-policy")({
  head: () => ({ meta: [{ title: "Privacy Policy | Kaipu Record" }] }),
  component: () => <LegalPage document="privacy" />,
});
