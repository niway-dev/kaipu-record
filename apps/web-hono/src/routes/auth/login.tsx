import { createFileRoute, redirect } from "@tanstack/react-router";

import { AuthPanel } from "@/components/auth/auth-panel";
import { parseOAuthErrorParam } from "@/lib/google-auth";
import { resolvePostSignInPath } from "@/lib/post-sign-in";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { NOINDEX } from "@/lib/seo";

/** The "Sign in" tab. A visitor who is already signed in goes where they were heading. */
export const Route = createFileRoute("/auth/login")({
  head: () => NOINDEX,
  component: LoginPage,
  validateSearch: (search: Record<string, unknown>): { redirect?: string; error?: string } => {
    const target = safeRedirectPath(search.redirect);
    // `error` is where Better Auth sends a failed Google sign-in (errorCallbackURL).
    const error = parseOAuthErrorParam(search.error);
    return { ...(target ? { redirect: target } : {}), ...(error ? { error } : {}) };
  },
  beforeLoad: async (ctx) => {
    const { isAuthenticated } = ctx.context;
    if (isAuthenticated) {
      throw redirect({ href: resolvePostSignInPath(ctx.search) });
    }
  },
});

function LoginPage() {
  const { redirect: redirectTo, error } = Route.useSearch();
  return <AuthPanel mode="sign-in" redirectTo={redirectTo} oauthError={error} />;
}
