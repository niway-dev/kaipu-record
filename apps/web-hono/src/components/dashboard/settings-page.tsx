import { useTranslations } from "@kaipu/i18n";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@kaipu/web-ui";
import type { AccountDeletionClient } from "@/lib/account-deletion";
import { hasPassword, useLinkedAccounts } from "@/hooks/use-linked-accounts";
import { DangerZone } from "@/components/account/danger-zone";
import { StorageSection } from "@/components/account/storage-section";
import { LocaleSwitcher } from "@/components/locale-switcher";

/** `/dashboard/settings`: plan and storage, language, and the danger zone. Pure composition. */
export function SettingsPage({
  email,
  deletionEnabled,
  deletionClient,
}: {
  email: string;
  deletionEnabled: boolean;
  deletionClient: AccountDeletionClient;
}) {
  const t = useTranslations("dashboard");
  const ts = useTranslations("settings");
  const accounts = useLinkedAccounts();

  return (
    <div className="mx-auto max-w-3xl space-y-6 py-6">
      <div>
        <h1 className="text-3xl font-bold">{t("settingsTitle")}</h1>
        <p className="text-muted-foreground mt-1">{t("settingsDescription")}</p>
      </div>
      <StorageSection />
      <Card>
        <CardHeader>
          <CardTitle>{t("languageTitle")}</CardTitle>
          <CardDescription>{ts("languageDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <LocaleSwitcher />
        </CardContent>
      </Card>
      <DangerZone
        email={email}
        hasPassword={hasPassword(accounts.data)}
        enabled={deletionEnabled}
        client={deletionClient}
      />
    </div>
  );
}
