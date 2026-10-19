import { createFileRoute, Outlet, useRouterState } from "@tanstack/react-router";

import { AppToaster } from "@/components/app-toaster";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { useDashboardControls } from "@/components/dashboard/use-dashboard-controls";

/**
 * Layout of `/dashboard/*` (design: "Kaipu Dashboard.dc.html"): the sidebar, or on a phone the
 * top bar and bottom tab bar, around whichever page is open.
 */
export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardLayout,
});

function DashboardLayout() {
  const { session } = Route.useRouteContext();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const controls = useDashboardControls();

  return (
    <DashboardShell
      user={{ name: session.user.name, email: session.user.email }}
      pathname={pathname}
      theme={controls.theme}
      onToggleTheme={controls.toggleTheme}
      onSignOut={controls.signOut}
      signingOut={controls.signingOut}
    >
      <Outlet />
      <AppToaster />
    </DashboardShell>
  );
}
