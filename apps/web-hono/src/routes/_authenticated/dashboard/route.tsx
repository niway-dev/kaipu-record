import { createFileRoute, Outlet } from "@tanstack/react-router";

import { DashboardNav } from "@/components/dashboard/dashboard-nav";

/** The signed-in hub: a sub-navigation over home, profile, settings and the recordings library. */
export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardLayout,
});

function DashboardLayout() {
  return (
    <div className="container mx-auto max-w-4xl px-4 pt-6">
      <DashboardNav />
      <Outlet />
    </div>
  );
}
