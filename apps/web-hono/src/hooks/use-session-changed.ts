import { useCallback } from "react";
import { useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { accountKeys } from "@/hooks/use-account-storage";
import { sessionKeys } from "@/hooks/use-session";

/**
 * Re-reads everything that came from the session: the header name (route context), the
 * verification badge, and the storage numbers that depend on a verified email.
 */
export function useSessionChanged(): () => Promise<void> {
  const router = useRouter();
  const queryClient = useQueryClient();
  return useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: sessionKeys.all });
    await queryClient.invalidateQueries({ queryKey: accountKeys.all });
    await router.invalidate();
  }, [queryClient, router]);
}
