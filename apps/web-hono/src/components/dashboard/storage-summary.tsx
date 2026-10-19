import { Link } from "@tanstack/react-router";
import { useTranslations } from "@kaipu/i18n";
import { Button, Card, CardAction, CardContent, CardHeader, CardTitle } from "@kaipu/web-ui";
import { StorageView } from "@/components/account/storage-section";
import { useAccountStorage } from "@/hooks/use-account-storage";

/**
 * The dashboard's one-glance plan and storage. It is the settings page's view in compact form, so
 * every state (loading, error, stale, suspended, ...) reads the same in both places and a failed
 * request never shows zeros. The breakdown stays on the settings page.
 */
export function StorageSummary() {
  const t = useTranslations("dashboard");
  const storage = useAccountStorage();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("summaryTitle")}</CardTitle>
        <CardAction>
          <Button variant="outline" size="sm" render={<Link to="/dashboard/settings" />}>
            {t("manage")}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <StorageView
          compact
          view={storage.view}
          plan={storage.plan}
          refreshing={storage.refreshing}
          onRefresh={storage.refresh}
        />
      </CardContent>
    </Card>
  );
}
