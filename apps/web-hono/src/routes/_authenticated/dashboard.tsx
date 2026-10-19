import { createFileRoute, Outlet } from "@tanstack/react-router";

import { DashboardNav } from "@/components/dashboard/dashboard-nav";

/** Layout of `/dashboard/*`: the signed-in hub's sub-navigation above whichever page is open. */
export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardLayout,
});

function DashboardLayout() {
  return (
    <>
      <DashboardNav />
      <Outlet />
    </>
  );
}
