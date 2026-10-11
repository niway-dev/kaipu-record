import { NOINDEX } from "@/lib/seo";
import { createFileRoute, redirect } from "@tanstack/react-router";

import { AppShell } from "@/components/app-shell";
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
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { session } = Route.useRouteContext();
  return <AppShell session={session} />;
}
