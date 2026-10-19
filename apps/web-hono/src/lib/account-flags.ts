import {
  createHttpAccountDeletionClient,
  mockAccountDeletionClient,
  type AccountDeletionClient,
} from "@/lib/account-deletion";
import { authClient } from "@/lib/auth/auth-client";

export interface AccountFlags {
  /** Danger zone is live; otherwise it renders a disabled "Coming soon" button. */
  deletionEnabled: boolean;
  /** Swap in the in-memory clients so the page works with no backend (local dev). */
  useMocks: boolean;
}

export function readAccountFlags(env: ImportMetaEnv = import.meta.env): AccountFlags {
  return {
    deletionEnabled: env.VITE_ACCOUNT_DELETION_ENABLED === "true",
    useMocks: env.VITE_ACCOUNT_USE_MOCKS === "true",
  };
}

/** Re-authenticates with the account password; the deletion route itself takes none. */
async function verifyPassword(password: string): Promise<boolean> {
  const session = await authClient.getSession();
  const email = session.data?.user.email;
  if (!email) return false;
  const result = await authClient.signIn.email({ email, password });
  return !result.error;
}

export function selectAccountDeletionClient(flags: AccountFlags): AccountDeletionClient {
  if (flags.useMocks) return mockAccountDeletionClient;
  return createHttpAccountDeletionClient({ verifyPassword });
}
