import { createFileRoute } from "@tanstack/react-router";

import { ResetPassword } from "@/components/auth/password-reset";
import { NOINDEX } from "@/lib/seo";

/** Where the reset link from the email lands: choose the new password. */
export const Route = createFileRoute("/auth/reset-password")({
  head: () => NOINDEX,
  // Hand-written rather than a zod schema: route options stay in the entry chunk,
  // so a zod import here would ship zod to every page, public ones included.
  validateSearch: (search: Record<string, unknown>): { token?: string } => ({
    token: typeof search.token === "string" ? search.token : undefined,
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const { token } = Route.useSearch();
  return <ResetPassword token={token} />;
}
