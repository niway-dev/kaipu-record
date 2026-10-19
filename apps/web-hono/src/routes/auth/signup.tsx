import { NOINDEX } from "@/lib/seo";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useTranslations } from "@kaipu/i18n";

import SignUpForm from "@/components/sign-up-form";
import {
  desktopAuthSearch,
  parseDesktopAuthQuery,
  type DesktopAuthQuery,
} from "@/lib/desktop-auth";
import { resolvePostSignInPath } from "@/lib/post-sign-in";
import { safeRedirectPath } from "@/lib/safe-redirect";

type SignUpSearch = { redirect?: string } & Partial<DesktopAuthQuery>;

export const Route = createFileRoute("/auth/signup")({
  head: () => NOINDEX,
  component: SignUpPage,
  validateSearch: (search: Record<string, unknown>): SignUpSearch => {
    const target = safeRedirectPath(search.redirect);
    // Sign-up opened from the desktop sign-in page (NIW2-471) keeps the app's query.
    const desktop = parseDesktopAuthQuery(search);
    return { ...(target ? { redirect: target } : {}), ...desktop };
  },
  beforeLoad: async (ctx) => {
    const { isAuthenticated } = ctx.context;
    if (isAuthenticated) {
      const desktop = parseDesktopAuthQuery(ctx.search);
      throw redirect({
        href: desktop
          ? `/auth/desktop${desktopAuthSearch(desktop)}`
          : resolvePostSignInPath(ctx.search),
      });
    }
  },
});

function SignUpPage() {
  const t = useTranslations("auth");
  const search = Route.useSearch();
  const desktop = parseDesktopAuthQuery(search) ?? undefined;
  return (
    <div className="mx-auto w-full mt-10 max-w-md p-6">
      <SignUpForm redirectTo={search.redirect} desktop={desktop} />
      <div className="mt-4 text-center text-sm text-muted-foreground">
        {t("haveAccount")}{" "}
        {desktop ? (
          <Link to="/auth/desktop" search={desktop} className="text-primary hover:underline">
            {t("signIn")}
          </Link>
        ) : (
          <Link to="/auth/login" className="text-primary hover:underline">
            {t("signIn")}
          </Link>
        )}
      </div>
    </div>
  );
}
