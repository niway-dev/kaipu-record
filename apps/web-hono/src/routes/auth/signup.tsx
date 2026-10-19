import { NOINDEX } from "@/lib/seo";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useTranslations } from "@kaipu/i18n";

import SignUpForm from "@/components/sign-up-form";
import { resolvePostSignInPath } from "@/lib/post-sign-in";
import { safeRedirectPath } from "@/lib/safe-redirect";

export const Route = createFileRoute("/auth/signup")({
  head: () => NOINDEX,
  component: SignUpPage,
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => {
    const target = safeRedirectPath(search.redirect);
    return target ? { redirect: target } : {};
  },
  beforeLoad: async (ctx) => {
    const { isAuthenticated } = ctx.context;
    if (isAuthenticated) {
      throw redirect({ href: resolvePostSignInPath(ctx.search) });
    }
  },
});

function SignUpPage() {
  const t = useTranslations("auth");
  const { redirect: redirectTo } = Route.useSearch();
  return (
    <div className="mx-auto w-full mt-10 max-w-md p-6">
      <SignUpForm redirectTo={redirectTo} />
      <div className="mt-4 text-center text-sm text-muted-foreground">
        {t("haveAccount")}{" "}
        <Link
          to="/auth/login"
          search={redirectTo ? { redirect: redirectTo } : {}}
          className="text-primary hover:underline"
        >
          {t("signIn")}
        </Link>
      </div>
    </div>
  );
}
