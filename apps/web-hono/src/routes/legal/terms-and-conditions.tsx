import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/legal/legal-page";

export const Route = createFileRoute("/legal/terms-and-conditions")({
  head: () => ({ meta: [{ title: "Terms and Conditions | Kaipu Record" }] }),
  component: () => <LegalPage document="terms" />,
});
