import React from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, CloudOff, KeyRound, PauseCircle, RefreshCw } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import type { AuthStatus } from "@shared/types/auth";
import { entitlementsFromStatus } from "@shared/entitlements";
import { Button } from "@renderer/ui/button";
import { Badge } from "@renderer/ui/badge";
import { barSegments, type CapacityView } from "./capacity-view";
import { formatBytesDecimal, MAX_VIDEO_BYTES } from "./format-bytes";
import styles from "./storage-cloud-settings.module.css";

type Translate = ReturnType<typeof useTranslations>;

function ageLabel(t: Translate, since: number, now: number): string {
  const minutes = Math.floor((now - since) / 60_000);
  if (minutes < 1) return t("ageJustNow");
  if (minutes < 60) return t("ageMinutes", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("ageHours", { count: hours });
  return t("ageDays", { count: Math.floor(hours / 24) });
}

/** How long the resend button stays disabled after a successful send. Long enough to stop a
 *  double-press, short enough that a mail which never arrived can be requested again. */
const RESEND_COOLDOWN_MS = 2 * 60_000;

function withinResendCooldown(sentAt: number | null, now: number): boolean {
  return sentAt !== null && now - sentAt < RESEND_COOLDOWN_MS;
}

function Notice({
  icon,
  title,
  detail,
  action,
  tone,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
  action?: React.ReactNode;
  tone: "neutral" | "warning" | "danger";
}): React.JSX.Element {
  return (
    <div className={styles.notice} data-tone={tone} role="status">
      <span className={styles.noticeIcon} aria-hidden>
        {icon}
      </span>
      <div className={styles.noticeText}>
        <span className={styles.noticeTitle}>{title}</span>
        <span className={styles.noticeDetail}>{detail}</span>
      </div>
      {action ? <div className={styles.noticeAction}>{action}</div> : null}
    </div>
  );
}

export interface CapacityCardProps {
  /** Signed-in or `unknown` (a stored token the app could not verify). */
  status: Extract<AuthStatus, { kind: "signed-in" | "unknown" }>;
  view: CapacityView;
  refreshing: boolean;
  onRefresh(): void;
  onSignOut(): void;
  now?: number;
}

/**
 * Account header plus cloud capacity for an account that has a token. Every query state has
 * its own rendering; none of them shows zeros for a failed query (design handoff §1).
 */
export function CapacityCard({
  status,
  view,
  refreshing,
  onRefresh,
  onSignOut,
  now = Date.now(),
}: CapacityCardProps): React.JSX.Element {
  const t = useTranslations("storageCloud");
  const ts = useTranslations("settings");
  const navigate = useNavigate();
  const email = status.kind === "signed-in" ? status.email : (status.lastKnownEmail ?? "");
  const entitlements = entitlementsFromStatus(status);
  const capacityBytes =
    view.kind === "usage"
      ? view.usage.capacityBytes
      : (entitlements?.features.cloudStorageBytes ?? null);
  const plan = entitlements?.plan === "pro" ? t("planPro") : t("planFree");
  const signIn = (): void => void navigate("/sign-in", { state: { from: "/cloud" } });

  // Only the in-flight attempt is component state. Whether a mail was ever sent comes from the
  // main process, which persists it with the session: this card is remounted on every visit to
  // the cloud screen, so component state would forget the send the moment the user navigates.
  const [attempt, setAttempt] = React.useState<"idle" | "pending" | "failed">("idle");
  const [sentNow, setSentNow] = React.useState<number | null>(null);
  const sentAt = sentNow ?? status.verificationEmailSentAt ?? null;

  async function handleResend(): Promise<void> {
    setAttempt("pending");
    const result = await window.electronAPI.resendVerificationEmail();
    if (result.ok) {
      setSentNow(result.sentAt);
      setAttempt("idle");
      return;
    }
    // A failure used to drop silently back to idle, which looked exactly like never having
    // pressed the button. Say so, and leave the button usable for another try.
    setAttempt("failed");
  }

  return (
    <div className={styles.capacity}>
      <div className={styles.accountHeader}>
        <span className={styles.avatar} aria-hidden>
          {(email[0] ?? "?").toUpperCase()}
        </span>
        <div className={styles.accountText}>
          <span className={styles.accountEmail}>{email}</span>
          <span className={styles.accountPlan}>
            {capacityBytes !== null
              ? t("planLabel", { plan, capacity: formatBytesDecimal(capacityBytes) })
              : plan}
          </span>
          {status.kind === "unknown" && (
            <span className={styles.accountUnknown}>{ts("accountUnknown")}</span>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={onSignOut}>
          {ts("signOut")}
        </Button>
      </div>

      {view.kind === "loading" && (
        <div className={styles.usage} aria-busy="true">
          <div className={styles.barTrack} data-loading>
            <span className={styles.srOnly}>{t("loading")}</span>
          </div>
          <div className={styles.legendSkeleton} aria-hidden />
        </div>
      )}

      {view.kind === "usage" && (
        <UsageBody view={view} refreshing={refreshing} onRefresh={onRefresh} now={now} />
      )}

      {view.kind === "error" && (
        <Notice
          tone="danger"
          icon={<AlertTriangle size={16} />}
          title={t("errorTitle")}
          detail={t("errorDetail")}
          action={
            <Button variant="outline" size="sm" onClick={onRefresh} disabled={refreshing}>
              {t("retry")}
            </Button>
          }
        />
      )}

      {view.kind === "session-expired" && (
        <Notice
          tone="warning"
          icon={<KeyRound size={16} />}
          title={t("expiredTitle")}
          detail={t("expiredDetail")}
          action={
            <Button size="sm" onClick={signIn}>
              {t("signInAgain")}
            </Button>
          }
        />
      )}

      {view.kind === "not-available" && (
        <Notice
          tone="neutral"
          icon={<CloudOff size={16} />}
          title={t("notAvailableTitle")}
          detail={t("notAvailableDetail")}
        />
      )}

      {view.kind === "beta-unavailable" && (
        <Notice
          tone="neutral"
          icon={<CloudOff size={16} />}
          title={t("betaTitle")}
          detail={
            attempt === "failed"
              ? t("resendVerificationFailed")
              : sentAt !== null
                ? t("resendVerificationSent")
                : t("betaDetail")
          }
          action={
            <>
              {/* Refreshing only makes sense once a mail is out: before that there is no
                  verification for the server to have recorded, so the button would invite a
                  round-trip that cannot change anything. A failed send leaves sentAt null,
                  which is why the failure must re-enable resend rather than offer refresh. */}
              {sentAt !== null && (
                <Button variant="outline" size="sm" onClick={onRefresh} disabled={refreshing}>
                  <RefreshCw size={12} aria-hidden /> {t("refresh")}
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleResend()}
                disabled={attempt === "pending" || withinResendCooldown(sentAt, now)}
              >
                {t("resendVerification")}
              </Button>
            </>
          }
        />
      )}
    </div>
  );
}

function UsageBody({
  view,
  refreshing,
  onRefresh,
  now,
}: {
  view: Extract<CapacityView, { kind: "usage" }>;
  refreshing: boolean;
  onRefresh(): void;
  now: number;
}): React.JSX.Element {
  const t = useTranslations("storageCloud");
  const { usage } = view;
  const segments = barSegments(usage);
  const used = formatBytesDecimal(usage.usedBytes);
  const reserved = formatBytesDecimal(usage.reservedBytes);
  const capacity = formatBytesDecimal(usage.capacityBytes);
  return (
    <div className={styles.usage} data-stale={view.staleSince !== null || undefined}>
      {view.staleSince !== null && (
        <div className={styles.staleRow}>
          <Badge variant="warning">{t("staleBadge")}</Badge>
          <span className={styles.staleDetail}>
            {t("staleDetail", { age: ageLabel(t, view.staleSince, now) })}
          </span>
          <Button variant="outline" size="sm" onClick={onRefresh} disabled={refreshing}>
            <RefreshCw size={12} aria-hidden /> {t("refresh")}
          </Button>
        </div>
      )}
      <div
        className={styles.barTrack}
        role="img"
        aria-label={t("barLabel", { used, reserved, capacity })}
      >
        <span className={styles.barUsed} style={{ width: `${segments.used}%` }} />
        <span className={styles.barReserved} style={{ width: `${segments.reserved}%` }} />
      </div>
      <dl className={styles.legend}>
        <div className={styles.legendItem}>
          <dt>
            <span className={styles.swatch} data-segment="used" aria-hidden />
            {t("used")}
          </dt>
          <dd>{used}</dd>
        </div>
        <div className={styles.legendItem}>
          <dt>
            <span className={styles.swatch} data-segment="reserved" aria-hidden />
            {t("reserved")}
          </dt>
          <dd>{reserved}</dd>
        </div>
        <div className={styles.legendItem}>
          <dt>
            <span className={styles.swatch} data-segment="available" aria-hidden />
            {t("available")}
          </dt>
          <dd>{formatBytesDecimal(usage.availableBytes)}</dd>
        </div>
      </dl>
      {view.suspended && (
        <Notice
          tone="warning"
          icon={<PauseCircle size={16} />}
          title={t("suspendedTitle")}
          detail={t("suspendedDetail")}
        />
      )}
      <p className={styles.footnote}>
        {t("limits", { perVideo: formatBytesDecimal(MAX_VIDEO_BYTES) })}
      </p>
    </div>
  );
}
