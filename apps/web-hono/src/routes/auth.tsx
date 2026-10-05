import { createFileRoute } from "@tanstack/react-router";

import { AppShell } from "@/components/app-shell";
import { getAuthSession } from "@/lib/auth/get-auth-session";

/**
 * Layout for every `/auth/*` page. It owns the app chrome and the session, so
 * the sign-in and sign-up routes can redirect a signed-in visitor.
 */
export const Route = createFileRoute("/auth")({
  beforeLoad: async () => {
    const session = await getAuthSession();
    return { session: session ?? null, isAuthenticated: !!session };
  },
  component: AuthLayout,
});

function AuthLayout() {
  const { session } = Route.useRouteContext();
  return <AppShell session={session} />;
}
