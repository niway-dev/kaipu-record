import React from "react";
import { useTranslations } from "@kaipu/i18n";
import { KaipuLogo } from "@renderer/shell/kaipu-logo";
import styles from "./panel-header.module.css";

interface PanelHeaderProps {
  onOpenMainWindow: () => void;
}

/** Capture Panel chrome: the Kaipu mark, app name, and "Open ↗". */
export function PanelHeader({ onOpenMainWindow }: PanelHeaderProps): React.JSX.Element {
  const t = useTranslations("panel");
  return (
    <div className={styles.header}>
      <div className={styles.brand}>
        <span className={styles.mark}>
          <KaipuLogo size={16} />
        </span>
        <span className={styles.name}>Kaipu Record</span>
      </div>
      <button type="button" className={styles.openButton} onClick={onOpenMainWindow}>
        {t("open")}
      </button>
    </div>
  );
}
