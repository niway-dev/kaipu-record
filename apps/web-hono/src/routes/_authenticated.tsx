import { NOINDEX } from "@/lib/seo";
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { getAuthSession } from "@/lib/auth/get-auth-session";

export const Route = createFileRoute("/_authenticated")({
  head: () => NOINDEX,
  beforeLoad: async ({ location }) => {
    const session = await getAuthSession();

    if (!session) {
      // `location.href` is the path plus its search, so the visitor returns to where they were.
      throw redirect({ to: "/auth/login", search: { redirect: location.href } });
    }
    return { session, isAuthenticated: true };
  },
  // The only signed-in section is `/dashboard`, whose layout draws its own frame
  // (`DashboardShell`), so this layout adds nothing around it.
  component: Outlet,
});
