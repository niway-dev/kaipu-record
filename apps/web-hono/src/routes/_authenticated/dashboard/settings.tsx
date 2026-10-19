import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";

import { SettingsPage } from "@/components/account/settings-page";
import { AccountControls } from "@/components/dashboard/dashboard-shell";
import { useDashboardControls } from "@/components/dashboard/use-dashboard-controls";
import { readAccountFlags, selectAccountDeletionClient } from "@/lib/account-flags";

export const Route = createFileRoute("/_authenticated/dashboard/settings")({
  component: SettingsRoute,
});

function SettingsRoute() {
  const { session } = Route.useRouteContext();
  const flags = useMemo(() => readAccountFlags(), []);
  const deletionClient = useMemo(() => selectAccountDeletionClient(flags), [flags]);
  const controls = useDashboardControls();
  return (
    <SettingsPage
      email={session.user.email}
      deletionEnabled={flags.deletionEnabled}
      deletionClient={deletionClient}
      mobileFooter={
        <AccountControls
          theme={controls.theme}
          onToggleTheme={controls.toggleTheme}
          onSignOut={controls.signOut}
          signingOut={controls.signingOut}
        />
      }
    />
  );
}
