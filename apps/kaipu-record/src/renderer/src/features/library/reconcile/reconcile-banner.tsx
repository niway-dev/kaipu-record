import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { Button } from "@kaipu/ui";
import {
  bannerContent,
  checkOnce,
  hideBanner,
  LISTED_SEEN_KEY,
  openReconcileDialog,
  useReconcile,
} from "./reconcile-store";
import styles from "./reconcile.module.css";

/**
 * "N files in your folder don't match Kaipu. Check and fix." — on the Library and Home
 * (NIW2-561). Checks once per session and vault folder; nothing changes on its own.
 */
export function ReconcileBanner(): React.JSX.Element | null {
  const t = useTranslations("library");
  const state = useReconcile();
  useEffect(() => {
    void checkOnce().catch(() => undefined);
  }, []);
  const content = bannerContent(state, localStorage.getItem(LISTED_SEEN_KEY));
  if (!content) return null;
  return (
    <div className={styles.banner} role="status" aria-live="polite">
      <AlertTriangle size={14} strokeWidth={2} />
      <span className={styles.bannerText}>
        {content.kind === "fixable"
          ? t("reconcileBannerFixable", { count: content.count })
          : t("reconcileBannerAttention", { count: content.count })}
      </span>
      <Button variant="outline" size="sm" onClick={openReconcileDialog}>
        {content.kind === "fixable" ? t("reconcileCheck") : t("reconcileReview")}
      </Button>
      <Button variant="ghost" size="sm" onClick={hideBanner}>
        {t("reconcileNotNow")}
      </Button>
    </div>
  );
}
