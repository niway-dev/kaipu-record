import { createFileRoute, Outlet } from "@tanstack/react-router";

import { AuthShell } from "@/components/auth/auth-shell";
import { getAuthSession } from "@/lib/auth/get-auth-session";

/**
 * Layout for every `/auth/*` page. It owns the session, so the sign-in and sign-up routes can
 * redirect a signed-in visitor and the desktop pages can show the account, and it renders the
 * design's two-panel page (`AuthShell`) instead of the app shell.
 */
export const Route = createFileRoute("/auth")({
  staticData: { shell: "auth" },
  beforeLoad: async () => {
    const session = await getAuthSession();
    return { session: session ?? null, isAuthenticated: !!session };
  },
  component: AuthLayout,
});

function AuthLayout() {
  return (
    <AuthShell>
      <Outlet />
    </AuthShell>
  );
}
