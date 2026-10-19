import { createFileRoute } from "@tanstack/react-router";

import { DesktopDonePage } from "@/components/desktop-auth/desktop-done-page";
import {
  CHECK_EMAIL_PARAM,
  parseCheckEmail,
  parseDesktopAuthQuery,
  type DesktopAuthQuery,
} from "@/lib/desktop-auth";
import { NOINDEX } from "@/lib/seo";

type DoneSearch = Partial<DesktopAuthQuery> & { check_email?: 1 };

/**
 * Where every desktop sign-in lands (NIW2-471). The code travels in a cookie, not in this URL; the
 * desktop query is kept in the search only so the URL says which flow the visitor is in.
 * `check_email=1` comes from an email sign-up and adds the "Check your email" note.
 */
export const Route = createFileRoute("/auth/desktop/done")({
  head: () => NOINDEX,
  validateSearch: (search: Record<string, unknown>): DoneSearch => ({
    ...parseDesktopAuthQuery(search),
    ...(parseCheckEmail(search[CHECK_EMAIL_PARAM]) ? { check_email: 1 as const } : {}),
  }),
  component: DesktopDoneRoute,
});

function DesktopDoneRoute() {
  const { session } = Route.useRouteContext();
  const search = Route.useSearch();
  return <DesktopDonePage session={session} checkEmail={search.check_email === 1} />;
}
