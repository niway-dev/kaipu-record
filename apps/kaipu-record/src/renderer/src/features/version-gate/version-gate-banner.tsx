import React from "react";
import { useTranslations } from "@kaipu/i18n";
import styles from "./version-gate-banner.module.css";

interface Props {
  message: string;
  downloadUrl: string;
}

/** Slim dismissible nudge for an outdated-but-usable build. */
export function VersionGateBanner({ message, downloadUrl }: Props): React.JSX.Element | null {
  const t = useTranslations("updates");
  const [dismissed, setDismissed] = React.useState(false);
  if (dismissed) return null;
  return (
    <div className={styles.banner}>
      <span className={styles.message}>{message}</span>
      <button className={styles.action} onClick={() => window.open(downloadUrl, "_blank")}>
        {t("update")}
      </button>
      <button className={styles.close} aria-label={t("close")} onClick={() => setDismissed(true)}>
        ×
      </button>
    </div>
  );
}
