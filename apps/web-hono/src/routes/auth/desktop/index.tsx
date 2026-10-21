import { createFileRoute } from "@tanstack/react-router";

import { DesktopSignInPage } from "@/components/desktop-auth/desktop-sign-in-page";
import {
  parseDesktopAuthIntent,
  parseDesktopAuthQuery,
  type DesktopAuthIntent,
  type DesktopAuthQuery,
} from "@/lib/desktop-auth";
import { parseOAuthErrorParam } from "@/lib/google-auth";
import { NOINDEX } from "@/lib/seo";

type DesktopSignInSearch = Partial<DesktopAuthQuery> & {
  intent?: DesktopAuthIntent;
  error?: string;
};

/**
 * Desktop sign-in through the browser (NIW2-471). Unlike `/auth/login`, a signed-in visitor is not
 * redirected: they confirm which account the app should use.
 */
export const Route = createFileRoute("/auth/desktop/")({
  head: () => NOINDEX,
  validateSearch: (search: Record<string, unknown>): DesktopSignInSearch => {
    const intent = parseDesktopAuthIntent(search.intent);
    const error = parseOAuthErrorParam(search.error);
    return {
      ...parseDesktopAuthQuery(search),
      ...(intent ? { intent } : {}),
      ...(error ? { error } : {}),
    };
  },
  component: DesktopSignInRoute,
});

function DesktopSignInRoute() {
  const { session } = Route.useRouteContext();
  const search = Route.useSearch();
  return (
    <DesktopSignInPage
      query={parseDesktopAuthQuery(search)}
      session={session}
      intent={search.intent}
      oauthError={search.error}
    />
  );
}
