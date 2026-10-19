import type { ReactNode } from "react";
import { useFormatter, useLocale, useTranslations, type Translator } from "@kaipu/i18n";
import { barSegments, isAlmostFull, isOverQuota, type CapacityView } from "@kaipu/domain/capacity";
import { MAX_VIDEO_BYTES } from "@kaipu/domain/constants";
import type { Entitlements } from "@kaipu/domain/schemas";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@kaipu/web-ui";
import { useAccountStorage } from "@/hooks/use-account-storage";
import { formatBytesForLocale } from "@/lib/format-bytes";
import { Notice } from "./notice";

type Plan = Pick<Entitlements, "plan"> & { currentPeriodEnd: Date | string | null };

function ageLabel(t: Translator<"storageCloud">, since: number, now: number): string {
  const minutes = Math.floor((now - since) / 60_000);
  if (minutes < 1) return t("ageJustNow");
  if (minutes < 60) return t("ageMinutes", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("ageHours", { count: hours });
  return t("ageDays", { count: Math.floor(hours / 24) });
}

const SIGN_IN_AGAIN = "/auth/login?redirect=%2Fdashboard";

export interface StorageViewProps {
  view: CapacityView;
  plan: Plan | null;
  refreshing: boolean;
  onRefresh(): void;
  now?: number;
  /**
   * The dashboard home's one-glance version: plan, bar and warnings, without the breakdown. Every
   * other state renders exactly as on the settings page.
   */
  compact?: boolean;
}

/**
 * Every query state has its own rendering; none of them shows zeros for a failed query (design
 * handoff §1). Numbers are the server's, formatted and never recomputed, except the bar widths.
 */
export function StorageView({
  view,
  plan,
  refreshing,
  onRefresh,
  now = Date.now(),
  compact = false,
}: StorageViewProps) {
  const t = useTranslations("account");
  const ts = useTranslations("storageCloud");
  const format = useFormatter();
  const locale = useLocale();
  const bytes = (n: number): string => formatBytesForLocale(n, locale);

  switch (view.kind) {
    case "signed-out":
      return null;
    case "loading":
      return (
        <div aria-busy="true" className="space-y-3">
          <div className="bg-muted h-3 w-full animate-pulse" data-loading />
          <span className="sr-only">{ts("loading")}</span>
        </div>
      );
    case "error":
      return (
        <Notice
          tone="destructive"
          title={ts("errorTitle")}
          detail={ts("errorDetail")}
          action={
            <Button variant="outline" size="sm" onClick={onRefresh} disabled={refreshing}>
              {ts("retry")}
            </Button>
          }
        />
      );
    case "session-expired":
      return (
        <Notice
          title={ts("expiredTitle")}
          detail={ts("expiredDetail")}
          action={
            <Button size="sm" render={<a href={SIGN_IN_AGAIN} />}>
              {ts("signInAgain")}
            </Button>
          }
        />
      );
    case "not-available":
      return <Notice title={ts("notAvailableTitle")} detail={ts("notAvailableDetail")} />;
    case "beta-unavailable":
      return <Notice title={ts("betaTitle")} detail={ts("betaDetail")} />;
    case "usage": {
      const { usage } = view;
      const segments = barSegments(usage);
      const over = isOverQuota(usage);
      const capacity = bytes(usage.capacityBytes);
      const used = bytes(usage.usedBytes);
      const reserved = bytes(usage.reservedBytes);
      const planName = plan?.plan === "pro" ? ts("planPro") : ts("planFree");
      return (
        <div className="space-y-4" data-stale={view.staleSince !== null || undefined}>
          {plan && (
            <p className="font-medium">
              {ts("planLabel", { plan: planName, capacity })}
              {plan.currentPeriodEnd
                ? ` · ${t("planUntil", {
                    date: format.dateTime(new Date(plan.currentPeriodEnd), { dateStyle: "medium" }),
                  })}`
                : ""}
            </p>
          )}
          {view.staleSince !== null && (
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{ts("staleBadge")}</Badge>
              <span className="text-muted-foreground text-sm">
                {ts("staleDetail", { age: ageLabel(ts, view.staleSince, now) })}
              </span>
              <Button variant="outline" size="sm" onClick={onRefresh} disabled={refreshing}>
                {ts("refresh")}
              </Button>
            </div>
          )}
          <div
            className="bg-muted flex h-3 w-full overflow-hidden"
            role="img"
            aria-label={ts("barLabel", { used, reserved, capacity })}
            data-over-quota={over || undefined}
          >
            <span
              className={over ? "bg-destructive" : "bg-primary"}
              style={{ width: `${segments.used}%` }}
              data-segment="used"
            />
            <span
              className="bg-primary/40"
              style={{ width: `${segments.reserved}%` }}
              data-segment="reserved"
            />
          </div>
          {compact && (
            <p className="text-muted-foreground text-sm">
              {ts("barLabel", { used, reserved, capacity })}
            </p>
          )}
          {!compact && (
            <dl className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <dt className="text-muted-foreground">{ts("used")}</dt>
                <dd className="font-medium">{used}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t("reservedInProgress")}</dt>
                <dd className="font-medium">{reserved}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{ts("available")}</dt>
                <dd className="font-medium">{bytes(usage.availableBytes)}</dd>
              </div>
            </dl>
          )}
          {!compact && usage.pendingUploads > 0 && (
            <p className="text-muted-foreground text-sm">
              {t("pendingUploads", { count: usage.pendingUploads })}
            </p>
          )}
          {view.suspended && <Notice title={ts("suspendedTitle")} detail={ts("suspendedDetail")} />}
          {over && (
            <Notice tone="destructive" title={t("overQuotaTitle")} detail={t("overQuotaDetail")} />
          )}
          {isAlmostFull(usage) && (
            <Notice title={t("almostFullTitle")} detail={t("almostFullDetail")} />
          )}
          {!compact && (
            <p className="text-muted-foreground text-xs">
              {ts("limits", { perVideo: bytes(MAX_VIDEO_BYTES) })}
            </p>
          )}
        </div>
      );
    }
  }
}

export function StorageSection(): ReactNode {
  const t = useTranslations("account");
  const storage = useAccountStorage();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("planTitle")}</CardTitle>
      </CardHeader>
      <CardContent>
        <StorageView
          view={storage.view}
          plan={storage.plan}
          refreshing={storage.refreshing}
          onRefresh={storage.refresh}
        />
      </CardContent>
    </Card>
  );
}
