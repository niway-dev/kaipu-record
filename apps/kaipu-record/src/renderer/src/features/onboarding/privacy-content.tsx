import { useTranslations } from "@kaipu/i18n";
import { Toggle } from "@kaipu/ui";
import { isWindowsHost } from "@renderer/features/shortcuts/host-platform";
import { useShareUsagePreference } from "./use-share-usage-preference";
import common from "./steps/step.module.css";
import styles from "./privacy-content.module.css";

/**
 * What Kaipu sends, what it never sends and from whom, with the toggle that stops it. The
 * body of both the privacy step and the one-time notice, so the two cannot drift apart.
 */
export function PrivacyContent(): React.JSX.Element {
  const t = useTranslations("onboarding");
  const { enabled, setEnabled } = useShareUsagePreference();
  const windows = isWindowsHost();
  return (
    <>
      <dl className={styles.facts}>
        <div className={`${common.card} ${styles.fact}`}>
          <dt className={styles.heading}>{t("privacySendHeading")}</dt>
          <dd className={styles.text}>{t("privacySend")}</dd>
        </div>
        <div className={`${common.card} ${styles.fact}`}>
          <dt className={styles.heading}>{t("privacyNeverHeading")}</dt>
          <dd className={styles.text}>{t("privacyNever")}</dd>
        </div>
        <div className={`${common.card} ${styles.fact}`}>
          <dt className={styles.heading}>{t("privacyIdentityHeading")}</dt>
          <dd className={styles.text}>
            {t(windows ? "privacyIdentityWindows" : "privacyIdentity")}
          </dd>
        </div>
      </dl>
      <div className={`${common.card} ${styles.toggleRow}`}>
        <span className={styles.toggleLabel}>{t("privacyToggle")}</span>
        <Toggle aria-label={t("privacyToggle")} checked={enabled} onChange={setEnabled} />
      </div>
      <p className={common.note}>{t("privacyLater")}</p>
    </>
  );
}
