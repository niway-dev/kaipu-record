import { createFileRoute } from "@tanstack/react-router";

import { ProfilePage } from "@/components/account/profile-page";
import { useSessionChanged } from "@/hooks/use-session-changed";

export const Route = createFileRoute("/_authenticated/dashboard/profile")({
  component: ProfileRoute,
});

function ProfileRoute() {
  const { session } = Route.useRouteContext();
  const onSessionChanged = useSessionChanged();
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
