import { Link } from "@tanstack/react-router";
import { useLocale, useTranslations } from "@kaipu/i18n";
import { barSegments, isAlmostFull, isOverQuota, type CapacityView } from "@kaipu/domain/capacity";
import {
  CloudLocked,
  CompactUsage,
  StorageView,
  type Plan,
} from "@/components/account/storage-section";
import { useAccountStorage } from "@/hooks/use-account-storage";
import { formatBytesForLocale } from "@/lib/format-bytes";
import { Card, textLinkProps } from "./ui";

const SIGN_IN_AGAIN = "/auth/login?redirect=%2Fdashboard";

interface StorageSummaryViewProps {
  view: CapacityView;
  plan: Plan | null;
  refreshing: boolean;
  onRefresh(): void;
}

/**
 * One line and one bar. No cloud access (email not verified) is the dashed "Verify your email"
 * line. Anything else that is not a plain, healthy usage reading (loading, error, expired session,
 * stale, suspended, over quota, almost full) is the full `StorageView`, so a failed request keeps
 * its retry and can never be mistaken for "0 B used".
 */
export function StorageSummaryView({ view, plan, refreshing, onRefresh }: StorageSummaryViewProps) {
  const ta = useTranslations("account");
  const ts = useTranslations("storageCloud");
  const t = useTranslations("dashboard");
  const locale = useLocale();

  if (view.kind === "beta-unavailable") return <CloudLocked />;

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
        compact
      />
    );
  }

  const { usage } = view;
  const bytes = (n: number): string => formatBytesForLocale(n, locale);
  const capacity = bytes(usage.capacityBytes);
  const used = bytes(usage.usedBytes);
  const reserved = bytes(usage.reservedBytes);
  return (
    <CompactUsage
      plan={plan}
      capacity={capacity}
      used={t("storageSummary", { used, capacity })}
      barLabel={ts("barLabel", { used, reserved, capacity })}
      segments={barSegments(usage)}
      pendingLabel={
        usage.pendingUploads > 0 ? ta("pendingUploads", { count: usage.pendingUploads }) : null
      }
    />
  );
}

export function StorageSummary() {
  const t = useTranslations("account");
  const td = useTranslations("dashboard");
  const storage = useAccountStorage();
  return (
    <Card
      title={t("planTitle")}
      action={
        <Link to="/dashboard/settings" {...textLinkProps()}>
          {td("storageManage")}
          <span aria-hidden> →</span>
        </Link>
      }
    >
      <StorageSummaryView
        view={storage.view}
        plan={storage.plan}
        refreshing={storage.refreshing}
        onRefresh={storage.refresh}
      />
    </Card>
  );
}
