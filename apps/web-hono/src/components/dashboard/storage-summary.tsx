import { Link } from "@tanstack/react-router";
import { useLocale, useTranslations } from "@kaipu/i18n";
import { barSegments, isAlmostFull, isOverQuota, type CapacityView } from "@kaipu/domain/capacity";
import { PLANS } from "@kaipu/domain/constants";
import type { Entitlements } from "@kaipu/domain/schemas";
import { Button, Card, CardAction, CardContent, CardHeader, CardTitle } from "@kaipu/web-ui";
import { StorageView } from "@/components/account/storage-section";
import { useAccountStorage } from "@/hooks/use-account-storage";
import { formatBytesForLocale } from "@/lib/format-bytes";

const SIGN_IN_AGAIN = "/auth/login?redirect=%2Fdashboard";

interface StorageSummaryViewProps {
  view: CapacityView;
  plan: (Pick<Entitlements, "plan"> & { currentPeriodEnd: Date | string | null }) | null;
  refreshing: boolean;
  onRefresh(): void;
}

/**
 * One line and one bar. Anything that is not a plain, healthy usage reading (loading, error,
 * expired session, stale, suspended, over quota, almost full) is the full `StorageView`, so a
 * failed request keeps its retry and can never be mistaken for "0 B used".
 */
export function StorageSummaryView({ view, plan, refreshing, onRefresh }: StorageSummaryViewProps) {
  const ts = useTranslations("storageCloud");
  const t = useTranslations("dashboard");
  const locale = useLocale();

  if (
    view.kind !== "usage" ||
    view.staleSince !== null ||
    view.suspended ||
    isOverQuota(view.usage) ||
    isAlmostFull(view.usage)
  ) {
    return (
      <StorageView
        view={view}
        plan={plan}
        refreshing={refreshing}
        onRefresh={onRefresh}
        signInAgainHref={SIGN_IN_AGAIN}
      />
    );
  }

  const { usage } = view;
  const bytes = (n: number): string => formatBytesForLocale(n, locale);
  const capacity = bytes(usage.capacityBytes);
  const used = bytes(usage.usedBytes);
  const reserved = bytes(usage.reservedBytes);
  const segments = barSegments(usage);
  const planName = ts(PLANS[plan?.plan ?? "free"].nameKey);

  return (
    <div className="space-y-3">
      {plan && <p className="font-medium">{ts("planLabel", { plan: planName, capacity })}</p>}
      <div
        className="bg-muted flex h-3 w-full overflow-hidden"
        role="img"
        aria-label={ts("barLabel", { used, reserved, capacity })}
      >
        <span className="bg-primary" style={{ width: `${segments.used}%` }} data-segment="used" />
        <span
          className="bg-primary/40"
          style={{ width: `${segments.reserved}%` }}
          data-segment="reserved"
        />
      </div>
      <p className="text-muted-foreground text-sm">{t("storageSummary", { used, capacity })}</p>
    </div>
  );
}

export function StorageSummary() {
  const t = useTranslations("account");
  const td = useTranslations("dashboard");
  const storage = useAccountStorage();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("planTitle")}</CardTitle>
        <CardAction>
          <Button variant="outline" size="sm" render={<Link to="/dashboard/settings" />}>
            {td("storageManage")}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <StorageSummaryView
          view={storage.view}
          plan={storage.plan}
          refreshing={storage.refreshing}
          onRefresh={storage.refresh}
        />
      </CardContent>
    </Card>
  );
}
