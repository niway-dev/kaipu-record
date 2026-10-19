import { createFileRoute } from "@tanstack/react-router";

import { ProfilePage } from "@/components/dashboard/profile-page";
import { useSessionRefresh } from "@/hooks/use-session-refresh";

export const Route = createFileRoute("/_authenticated/dashboard/profile")({
  component: ProfileRoute,
});

function ProfileRoute() {
  const { session } = Route.useRouteContext();
  const onSessionChanged = useSessionRefresh();

  return (
    <ProfilePage
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
