import { useTranslations } from "@kaipu/i18n";
import type { AccountDeletionClient } from "@/lib/account-deletion";
import { hasPassword, useLinkedAccounts } from "@/hooks/use-linked-accounts";
import { DangerZone } from "./danger-zone";
import { ProfileSection, type AccountUser } from "./profile-section";
import { SignInMethodsSection } from "./sign-in-methods-section";
import { StorageSection } from "./storage-section";

export interface AccountPageProps {
  user: AccountUser;
  onSessionChanged: () => Promise<void>;
  deletionEnabled: boolean;
  deletionClient: AccountDeletionClient;
}

/** The four sections of `/account`. Pure composition: each section owns its own data. */
export function AccountPage({
  user,
  onSessionChanged,
  deletionEnabled,
  deletionClient,
}: AccountPageProps) {
  const t = useTranslations("account");
  const accounts = useLinkedAccounts();

  return (
    <div className="container mx-auto max-w-3xl space-y-6 px-4 py-8">
      <div>
        <h1 className="text-3xl font-bold">{t("title")}</h1>
        <p className="text-muted-foreground mt-1">{t("description")}</p>
      </div>
      <ProfileSection user={user} onSessionChanged={onSessionChanged} />
      <SignInMethodsSection />
      <StorageSection />
      <DangerZone
        email={user.email}
        hasPassword={hasPassword(accounts.data)}
        enabled={deletionEnabled}
        client={deletionClient}
      />
    </div>
  );
}
