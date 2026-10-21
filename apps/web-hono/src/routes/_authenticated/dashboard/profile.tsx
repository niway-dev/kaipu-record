import { createFileRoute } from "@tanstack/react-router";

import { ProfilePage } from "@/components/account/profile-page";
import { useSessionChanged } from "@/hooks/use-session-changed";
import { parseOAuthErrorParam } from "@/lib/google-auth";

export const Route = createFileRoute("/_authenticated/dashboard/profile")({
  component: ProfileRoute,
  validateSearch: (search: Record<string, unknown>): { error?: string } => {
    const error = parseOAuthErrorParam(search.error);
    return error ? { error } : {};
  },
});

function ProfileRoute() {
  const { session } = Route.useRouteContext();
  const onSessionChanged = useSessionChanged();
  const { error } = Route.useSearch();
  return (
    <ProfilePage
      user={{
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        emailVerified: session.user.emailVerified,
      }}
      onSessionChanged={onSessionChanged}
      oauthError={error}
    />
  );
}
