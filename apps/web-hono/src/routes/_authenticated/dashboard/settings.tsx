import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";

import { SettingsPage } from "@/components/account/settings-page";
import { readAccountFlags, selectAccountDeletionClient } from "@/lib/account-flags";

export const Route = createFileRoute("/_authenticated/dashboard/settings")({
  component: SettingsRoute,
});

function SettingsRoute() {
  const { session } = Route.useRouteContext();
  const flags = useMemo(() => readAccountFlags(), []);
  const deletionClient = useMemo(() => selectAccountDeletionClient(flags), [flags]);
  return (
    <SettingsPage
      email={session.user.email}
      deletionEnabled={flags.deletionEnabled}
      deletionClient={deletionClient}
    />
  );
}
