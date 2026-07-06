import React from "react";
import { useTranslations } from "@kaipu/i18n";
import styles from "./update-banner.module.css";

interface Props {
  version: string;
}

/** Slim dismissible banner shown when an update is downloaded and ready to apply. */
export function UpdateBanner({ version }: Props): React.JSX.Element | null {
  const t = useTranslations("updates");
  const [dismissed, setDismissed] = React.useState(false);
  if (dismissed) return null;
  return (
    <div className={styles.banner}>
      <span className={styles.message}>{t("ready", { version })}</span>
      <button
        type="button"
        className={styles.action}
        onClick={() => window.electronAPI.installUpdate()}
      >
        {t("restart")}
      </button>
      <button
        type="button"
        className={styles.close}
        aria-label={t("close")}
        onClick={() => setDismissed(true)}
      >
        ×
      </button>
    </div>
  );
}
