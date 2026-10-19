import type { ReactNode } from "react";
import * as stylex from "@stylexjs/stylex";
import { Cloud, Info, Lock, Pause, RefreshCw, TriangleAlert } from "lucide-react";
import { useFormatter, useLocale, useTranslations, type Translator } from "@kaipu/i18n";
import { barSegments, isAlmostFull, isOverQuota, type CapacityView } from "@kaipu/domain/capacity";
import { MAX_VIDEO_BYTES, PLANS } from "@kaipu/domain/constants";
import type { Entitlements } from "@kaipu/domain/schemas";
import { useAccountStorage } from "@/hooks/use-account-storage";
import { formatBytesForLocale } from "@/lib/format-bytes";
import { bp, kl, tone } from "../dashboard/dashboard.stylex";
import { Button, Card, Notice, Skeleton, Tag, buttonProps } from "@/components/dashboard/ui";

export type Plan = Pick<Entitlements, "plan"> & { currentPeriodEnd: Date | string | null };

function ageLabel(t: Translator<"storageCloud">, since: number, now: number): string {
  const minutes = Math.floor((now - since) / 60_000);
  if (minutes < 1) return t("ageJustNow");
  if (minutes < 60) return t("ageMinutes", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("ageHours", { count: hours });
  return t("ageDays", { count: Math.floor(hours / 24) });
}

const SIGN_IN_AGAIN = "/auth/login?redirect=%2Fdashboard%2Fsettings";

const s = stylex.create({
  stack: { display: "flex", flexDirection: "column", gap: "16px" },
  planLine: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: "9px", margin: 0 },
  planIcon: { display: "flex", color: kl.dim },
  planText: { fontSize: "14.5px", fontWeight: 600, color: kl.tx },
  bar: {
    display: "flex",
    overflow: "hidden",
    height: "14px",
    borderRadius: "14px",
    backgroundColor: kl.card2,
  },
  barCompact: { height: "9px", marginTop: "14px" },
  used: { backgroundColor: kl.pink },
  usedOver: { backgroundColor: tone.red },
  reserved: { backgroundColor: tone.pinkReserved },
  stats: {
    display: "grid",
    gridTemplateColumns: { default: "repeat(3, minmax(0, 1fr))", [bp.mobile]: "1fr" },
    gap: "10px",
    margin: 0,
  },
  stat: {
    minWidth: 0,
    paddingBlock: "11px",
    paddingInline: "13px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: kl.bd,
    borderRadius: "10px",
    backgroundColor: kl.bg2,
  },
  statKey: {
    fontFamily: kl.fontMono,
    fontSize: "10px",
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: kl.faint,
  },
  statValue: {
    margin: 0,
    marginTop: "5px",
    fontFamily: kl.fontMono,
    fontSize: "16px",
    fontWeight: 500,
    color: kl.tx,
  },
  statValueOver: { color: tone.red },
  statSub: { marginTop: "3px", fontSize: "11.5px", lineHeight: 1.35, color: kl.faint },
  pending: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    margin: 0,
    fontSize: "13px",
    color: kl.dim,
  },
  dot: { width: "7px", height: "7px", borderRadius: "50%", backgroundColor: kl.pink },
  footnote: { margin: 0, fontSize: "12.5px", color: kl.faint },
  compactRow: {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: "10px",
    marginTop: "9px",
  },
  compactUsed: { margin: 0, fontFamily: kl.fontMono, fontSize: "12.5px", color: kl.dim },
  compactPending: { margin: 0, fontFamily: kl.fontMono, fontSize: "12px", color: kl.faint },
  srOnly: {
    position: "absolute",
    width: "1px",
    height: "1px",
    overflow: "hidden",
    clip: "rect(0 0 0 0)",
    whiteSpace: "nowrap",
  },
  loadingStats: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: "12px",
  },
  locked: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    paddingBlock: "12px",
    paddingInline: "14px",
    borderWidth: "1px",
    borderStyle: "dashed",
    borderColor: kl.bd2,
    borderRadius: "12px",
    color: kl.dim,
    fontSize: "14px",
  },
});

/** "Plan Free · 1 GB", with the stale and paused tags beside it when they apply. */
export function PlanLine({
  plan,
  capacity,
  stale = false,
  paused = false,
}: {
  plan: Plan;
  capacity: string;
  stale?: boolean;
  paused?: boolean;
}) {
  const t = useTranslations("account");
  const ts = useTranslations("storageCloud");
  const format = useFormatter();
  const planName = ts(PLANS[plan.plan].nameKey);
  const until = plan.currentPeriodEnd
    ? ` · ${t("planUntil", {
        date: format.dateTime(new Date(plan.currentPeriodEnd), { dateStyle: "medium" }),
      })}`
    : "";
  return (
    <div {...stylex.props(s.planLine)}>
      <span aria-hidden {...stylex.props(s.planIcon)}>
        <Cloud size={16} strokeWidth={1.8} />
      </span>
      <span {...stylex.props(s.planText)}>
        {ts("planLabel", { plan: planName, capacity })}
        {until}
      </span>
      {stale ? <Tag tone="warn">{ts("staleBadge")}</Tag> : null}
      {paused ? <Tag tone="warn">{t("pausedBadge")}</Tag> : null}
    </div>
  );
}

/** The two-segment bar: used in solid pink (red over quota), reserved in pink at 40%. */
export function UsageBar({
  segments,
  label,
  over,
  compact = false,
}: {
  segments: { used: number; reserved: number };
  label: string;
  over: boolean;
  compact?: boolean;
}) {
  return (
    <div
      role="img"
      aria-label={label}
      data-over-quota={over || undefined}
      {...stylex.props(s.bar, compact && s.barCompact)}
    >
      <span
        data-segment="used"
        {...stylex.props(over ? s.usedOver : s.used)}
        style={{ width: `${segments.used}%` }}
      />
      <span
        data-segment="reserved"
        {...stylex.props(s.reserved)}
        style={{ width: `${segments.reserved}%` }}
      />
    </div>
  );
}

/** The home's dashed "Verify your email to use cloud" line, in place of a bar. */
export function CloudLocked() {
  const ts = useTranslations("storageCloud");
  return (
    <div {...stylex.props(s.locked)}>
      <Lock size={16} aria-hidden />
      {ts("betaTitle")}
    </div>
  );
}

export interface StorageViewProps {
  view: CapacityView;
  plan: Plan | null;
  refreshing: boolean;
  onRefresh(): void;
  now?: number;
  /** Where "sign in again" returns to; defaults to the settings page, where this view lives. */
  signInAgainHref?: string;
  /** The home's compact loading skeleton (no stat row). */
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
  signInAgainHref = SIGN_IN_AGAIN,
  compact = false,
}: StorageViewProps) {
  const t = useTranslations("account");
  const ts = useTranslations("storageCloud");
  const locale = useLocale();
  const bytes = (n: number): string => formatBytesForLocale(n, locale);
  const retry = (
    <Button
      size="sm"
      icon={<RefreshCw size={15} aria-hidden />}
      onClick={onRefresh}
      disabled={refreshing}
    >
      {ts("retry")}
    </Button>
  );

  switch (view.kind) {
    case "signed-out":
      return null;
    case "loading":
      return (
        <div aria-busy="true" {...stylex.props(s.stack)}>
          <span role="status" {...stylex.props(s.srOnly)}>
            {ts("loading")}
          </span>
          <Skeleton width={160} height={14} />
          <Skeleton height={compact ? 8 : 14} />
          {compact ? null : (
            <div {...stylex.props(s.loadingStats)}>
              <Skeleton height={44} />
              <Skeleton height={44} />
              <Skeleton height={44} />
            </div>
          )}
        </div>
      );
    case "error":
      return (
        <Notice
          role="alert"
          icon={<TriangleAlert size={18} />}
          title={ts("errorTitle")}
          detail={ts("errorDetail")}
          actions={retry}
        />
      );
    case "session-expired":
      return (
        <Notice
          icon={<Lock size={18} />}
          title={ts("expiredTitle")}
          detail={ts("expiredDetail")}
          actions={
            <a href={signInAgainHref} {...buttonProps({ variant: "pink", size: "sm" })}>
              {ts("signInAgain")}
            </a>
          }
        />
      );
    case "not-available":
      return (
        <Notice
          icon={<Info size={18} />}
          title={ts("notAvailableTitle")}
          detail={ts("notAvailableDetail")}
        />
      );
    case "beta-unavailable":
      return <Notice icon={<Lock size={18} />} title={ts("betaTitle")} detail={ts("betaDetail")} />;
    case "usage": {
      const { usage } = view;
      const over = isOverQuota(usage);
      const stale = view.staleSince !== null;
      const capacity = bytes(usage.capacityBytes);
      const used = bytes(usage.usedBytes);
      const reserved = bytes(usage.reservedBytes);
      const stat = (key: string, value: string, sub?: string, red = false): ReactNode => (
        <div {...stylex.props(s.stat)}>
          <dt {...stylex.props(s.statKey)}>{key}</dt>
          <dd {...stylex.props(s.statValue, red && s.statValueOver)}>{value}</dd>
          {sub ? <dd {...stylex.props(s.statSub)}>{sub}</dd> : null}
        </div>
      );
      return (
        <div data-stale={stale || undefined} {...stylex.props(s.stack)}>
          {plan && (
            <PlanLine plan={plan} capacity={capacity} stale={stale} paused={view.suspended} />
          )}
          <UsageBar
            segments={barSegments(usage)}
            label={ts("barLabel", { used, reserved, capacity })}
            over={over}
          />
          <dl {...stylex.props(s.stats)}>
            {stat(ts("used"), used, undefined, over)}
            {stat(t("inProgress"), reserved, ts("reserved"))}
            {stat(ts("available"), bytes(usage.availableBytes))}
          </dl>
          {usage.pendingUploads > 0 && (
            <p {...stylex.props(s.pending)}>
              <span aria-hidden {...stylex.props(s.dot)} />
              {t("pendingUploads", { count: usage.pendingUploads })}
            </p>
          )}
          {stale && view.staleSince !== null && (
            <Notice
              tone="warn"
              icon={<Info size={18} />}
              title={t("staleTitle", { age: ageLabel(ts, view.staleSince, now) })}
              detail={t("staleBody")}
              actions={
                <Button
                  size="sm"
                  icon={<RefreshCw size={15} aria-hidden />}
                  onClick={onRefresh}
                  disabled={refreshing}
                >
                  {ts("refresh")}
                </Button>
              }
            />
          )}
          {view.suspended && (
            <Notice
              icon={<Pause size={18} />}
              title={ts("suspendedTitle")}
              detail={ts("suspendedDetail")}
            />
          )}
          {over && (
            <Notice
              tone="danger"
              icon={<TriangleAlert size={18} />}
              title={t("overQuotaTitle")}
              detail={t("overQuotaDetail")}
            />
          )}
          {isAlmostFull(usage) && (
            <Notice
              tone="warn"
              icon={<TriangleAlert size={18} />}
              title={t("almostFullTitle")}
              detail={t("almostFullDetail")}
            />
          )}
          <p {...stylex.props(s.footnote)}>{ts("limits", { perVideo: bytes(MAX_VIDEO_BYTES) })}</p>
        </div>
      );
    }
  }
}

/** The compact healthy reading on the home: plan line, a thin bar, "used of capacity". */
export function CompactUsage({
  plan,
  capacity,
  used,
  barLabel,
  segments,
  pendingLabel,
}: {
  plan: Plan | null;
  capacity: string;
  used: string;
  barLabel: string;
  segments: { used: number; reserved: number };
  pendingLabel: string | null;
}) {
  return (
    <div>
      {plan && <PlanLine plan={plan} capacity={capacity} />}
      <UsageBar segments={segments} label={barLabel} over={false} compact />
      <div {...stylex.props(s.compactRow)}>
        <p {...stylex.props(s.compactUsed)}>{used}</p>
        {pendingLabel ? <p {...stylex.props(s.compactPending)}>{pendingLabel}</p> : null}
      </div>
    </div>
  );
}

export function StorageSection(): ReactNode {
  const t = useTranslations("account");
  const storage = useAccountStorage();
  return (
    <Card title={t("planTitle")}>
      <StorageView
        view={storage.view}
        plan={storage.plan}
        refreshing={storage.refreshing}
        onRefresh={storage.refresh}
      />
    </Card>
  );
}
