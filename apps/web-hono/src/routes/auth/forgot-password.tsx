import { createFileRoute } from "@tanstack/react-router";

import { ForgotPassword } from "@/components/auth/password-reset";
import { NOINDEX } from "@/lib/seo";

/** The design's "Reset your password" view. The reset itself stays a link sent by email. */
export const Route = createFileRoute("/auth/forgot-password")({
  head: () => NOINDEX,
  component: ForgotPassword,
});
