import { useTranslations } from "@kaipu/i18n";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@kaipu/web-ui";
import type { AccountDeletionClient } from "@/lib/account-deletion";
import { hasPassword, useLinkedAccounts } from "@/hooks/use-linked-accounts";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { DangerZone } from "./danger-zone";
import { StorageSection } from "./storage-section";

export interface SettingsPageProps {
  email: string;
  deletionEnabled: boolean;
  deletionClient: AccountDeletionClient;
}

/** `/dashboard/settings`: plan and storage, language and the danger zone. */
export function SettingsPage({ email, deletionEnabled, deletionClient }: SettingsPageProps) {
  const t = useTranslations("dashboard");
  const accounts = useLinkedAccounts();

  return (
    <div className="container mx-auto max-w-3xl space-y-6 px-4 py-8">
      <div>
        <h1 className="text-3xl font-bold">{t("settingsTitle")}</h1>
        <p className="text-muted-foreground mt-1">{t("settingsDescription")}</p>
      </div>
      <StorageSection />
      <Card>
        <CardHeader>
          <CardTitle>{t("languageTitle")}</CardTitle>
          <CardDescription>{t("languageDescription")}</CardDescription>
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
