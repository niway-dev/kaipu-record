import { createFileRoute } from "@tanstack/react-router";

import { DesktopSignInPage } from "@/components/desktop-auth/desktop-sign-in-page";
import { parseDesktopAuthQuery, type DesktopAuthQuery } from "@/lib/desktop-auth";
import { NOINDEX } from "@/lib/seo";

/**
 * Desktop sign-in through the browser (NIW2-471). Unlike `/auth/login`, a signed-in visitor is not
 * redirected: they confirm which account the app should use.
 */
export const Route = createFileRoute("/auth/desktop/")({
  head: () => NOINDEX,
  validateSearch: (search: Record<string, unknown>): Partial<DesktopAuthQuery> =>
    parseDesktopAuthQuery(search) ?? {},
  component: DesktopSignInRoute,
});

function DesktopSignInRoute() {
  const { session } = Route.useRouteContext();
  const query = parseDesktopAuthQuery(Route.useSearch());
  return <DesktopSignInPage query={query} session={session} />;
}
