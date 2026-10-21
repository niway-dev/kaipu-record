import { useQuery } from "@tanstack/react-query";
import { authClient } from "@/lib/auth/auth-client";
import { accountKeys } from "@/hooks/use-account-storage";

export interface LinkedAccount {
  id: string;
  providerId: string;
  createdAt: Date | string;
}

export const linkedAccountsKey = () => [...accountKeys.all, "linked-accounts"] as const;

/** The sign-in methods Better Auth has for the signed-in user (`credential` = password). */
export function useLinkedAccounts() {
  return useQuery({
    queryKey: linkedAccountsKey(),
    queryFn: async (): Promise<LinkedAccount[]> => {
      const result = await authClient.listAccounts();
      if (result.error || !result.data) throw new Error(result.error?.message ?? "No accounts");
      return result.data;
    },
  });
}

export const hasPassword = (accounts: LinkedAccount[] | undefined): boolean =>
  accounts === undefined ? true : accounts.some((a) => a.providerId === "credential");
