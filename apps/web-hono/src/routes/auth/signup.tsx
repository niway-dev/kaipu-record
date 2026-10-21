import { createFileRoute, redirect } from "@tanstack/react-router";

import { AuthPanel } from "@/components/auth/auth-panel";
import {
  desktopAuthSearch,
  parseDesktopAuthQuery,
  type DesktopAuthQuery,
} from "@/lib/desktop-auth";
import { resolvePostSignInPath } from "@/lib/post-sign-in";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { NOINDEX } from "@/lib/seo";

type SignUpSearch = { redirect?: string } & Partial<DesktopAuthQuery>;

/**
 * The "Create account" tab. It still accepts the desktop query (NIW2-471): an older link from the
 * desktop sign-in page pointed here, and it keeps working, with its tabs leading back to
 * `/auth/desktop`.
 */
export const Route = createFileRoute("/auth/signup")({
  head: () => NOINDEX,
  component: SignUpPage,
  validateSearch: (search: Record<string, unknown>): SignUpSearch => {
    const target = safeRedirectPath(search.redirect);
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
  const search = Route.useSearch();
  const desktop = parseDesktopAuthQuery(search) ?? undefined;
  return <AuthPanel mode="sign-up" redirectTo={search.redirect} desktop={desktop} />;
}
