import { NOINDEX } from "@/lib/seo";
import { createFileRoute, redirect } from "@tanstack/react-router";

import { AppShell } from "@/components/app-shell";
import { getAuthSession } from "@/lib/auth/get-auth-session";

export const Route = createFileRoute("/_authenticated")({
  head: () => NOINDEX,
  beforeLoad: async () => {
    const session = await getAuthSession();

    if (!session) {
      throw redirect({ to: "/auth/login" });
    }
    return { session, isAuthenticated: true };
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { session } = Route.useRouteContext();
  return <AppShell session={session} />;
}
