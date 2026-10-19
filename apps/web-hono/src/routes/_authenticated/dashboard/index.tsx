import { createFileRoute } from "@tanstack/react-router";

import { DashboardHome } from "@/components/dashboard/dashboard-home";
import { useSessionChanged } from "@/hooks/use-session-changed";

export const Route = createFileRoute("/_authenticated/dashboard/")({
  component: DashboardRoute,
});

function DashboardRoute() {
  const { session } = Route.useRouteContext();
  const onSessionChanged = useSessionChanged();
  return (
    <DashboardHome
      user={{
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        emailVerified: session.user.emailVerified,
      }}
      onSessionChanged={onSessionChanged}
    />
  );
}
