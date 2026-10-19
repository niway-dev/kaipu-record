import { NOINDEX } from "@/lib/seo";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useTranslations } from "@kaipu/i18n";

import { OAuthErrorAlert } from "@/components/oauth-error-alert";
import SignInForm from "@/components/sign-in-form";
import { parseOAuthErrorParam } from "@/lib/google-auth";
import { resolvePostSignInPath } from "@/lib/post-sign-in";
import { safeRedirectPath } from "@/lib/safe-redirect";

function LoginPage() {
  const t = useTranslations("auth");
  const { redirect: redirectTo, error } = Route.useSearch();
  return (
    <div className="mx-auto w-full mt-10 max-w-md p-6">
      <OAuthErrorAlert code={error} />
      <SignInForm redirectTo={redirectTo} />
      <div className="mt-4 text-center text-sm text-muted-foreground">
        {t("needAccount")}{" "}
        <Link to="/auth/signup" className="text-primary hover:underline">
          {t("signUp")}
        </Link>
      </div>
      <div className="mt-2 text-center text-sm text-muted-foreground">
        <Link to="/auth/forgot-password" className="text-primary hover:underline">
          {t("forgotPassword")}
        </Link>
      </div>
    </div>
  );
}

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
