import { createFileRoute } from "@tanstack/react-router";

import { EmailVerified } from "@/components/auth/email-verified";
import { NOINDEX } from "@/lib/seo";

/** Where the verification link from the email lands (`buildVerifyUrl` on the API). */
export const Route = createFileRoute("/auth/email-verified")({
  head: () => NOINDEX,
  // Hand-written rather than a zod schema: route options stay in the entry chunk,
  // so a zod import here would ship zod to every page, public ones included.
  validateSearch: (search: Record<string, unknown>): { error?: string } => ({
    error: typeof search.error === "string" ? search.error : undefined,
  }),
  component: EmailVerifiedPage,
});

function EmailVerifiedPage() {
  const { error } = Route.useSearch();
  return <EmailVerified error={error} />;
}
