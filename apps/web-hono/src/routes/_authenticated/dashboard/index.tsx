import { createFileRoute } from "@tanstack/react-router";

import { GetStarted } from "@/components/dashboard/get-started";
import { StorageSummary } from "@/components/dashboard/storage-summary";
import { WelcomeSection } from "@/components/dashboard/welcome-section";
import { useSessionRefresh } from "@/hooks/use-session-refresh";

export const Route = createFileRoute("/_authenticated/dashboard/")({
  component: DashboardHome,
});

function DashboardHome() {
  const { session } = Route.useRouteContext();
  const onSessionChanged = useSessionRefresh();

  return (
    <div className="space-y-6 py-6">
      <WelcomeSection
        user={{
          id: session.user.id,
          name: session.user.name,
          email: session.user.email,
          emailVerified: session.user.emailVerified,
        }}
        onSessionChanged={onSessionChanged}
      />
      <StorageSummary />
      <GetStarted />
    </div>
  );
}
