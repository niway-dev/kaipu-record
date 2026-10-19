import { createFileRoute } from "@tanstack/react-router";

import { DesktopDonePage } from "@/components/desktop-auth/desktop-done-page";
import { parseDesktopAuthQuery, type DesktopAuthQuery } from "@/lib/desktop-auth";
import { NOINDEX } from "@/lib/seo";

/**
 * Where every desktop sign-in lands (NIW2-471). The code travels in a cookie, not in this URL; the
 * desktop query is kept in the search only so the URL says which flow the visitor is in.
 */
export const Route = createFileRoute("/auth/desktop/done")({
  head: () => NOINDEX,
  validateSearch: (search: Record<string, unknown>): Partial<DesktopAuthQuery> =>
    parseDesktopAuthQuery(search) ?? {},
  component: DesktopDonePage,
});
