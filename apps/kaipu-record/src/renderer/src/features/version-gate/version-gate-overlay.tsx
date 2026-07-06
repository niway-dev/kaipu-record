import React from "react";
import { useTranslations } from "@kaipu/i18n";
import styles from "./version-gate-overlay.module.css";

interface Props {
  message: string;
  downloadUrl: string;
}

/** Full-screen, non-dismissible block for an unsupported build. */
export function VersionGateOverlay({ message, downloadUrl }: Props): React.JSX.Element {
  const t = useTranslations("updates");
  return (
    <div className={styles.overlay} role="alertdialog" aria-modal="true">
      <div className={styles.card}>
        <h1 className={styles.title}>{t("updateRequired")}</h1>
        <p className={styles.message}>{message}</p>
        <button className={styles.button} onClick={() => window.open(downloadUrl, "_blank")}>
          {t("update")}
        </button>
      </div>
    </div>
  );
}
