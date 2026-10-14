import { useCallback, useMemo } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";

import { AccountPage } from "@/components/account/account-page";
import { accountKeys } from "@/hooks/use-account-storage";
import { sessionKeys } from "@/hooks/use-session";
import { readAccountFlags, selectAccountDeletionClient } from "@/lib/account-flags";

export const Route = createFileRoute("/_authenticated/account/")({
  component: AccountRoute,
});

function AccountRoute() {
  const { session } = Route.useRouteContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const flags = useMemo(() => readAccountFlags(), []);
  const deletionClient = useMemo(() => selectAccountDeletionClient(flags), [flags]);

  // Everything that came from the session: the header name (route context), the verification
  // badge, and the storage numbers that depend on a verified email.
  const onSessionChanged = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: sessionKeys.all });
    await queryClient.invalidateQueries({ queryKey: accountKeys.all });
    await router.invalidate();
  }, [queryClient, router]);

  return (
    <AccountPage
      user={{
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        emailVerified: session.user.emailVerified,
      }}
      onSessionChanged={onSessionChanged}
      deletionEnabled={flags.deletionEnabled}
      deletionClient={deletionClient}
    />
  );
}
