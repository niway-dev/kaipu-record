import React from "react";
import { KaipuMark } from "@renderer/shell/kaipu-mark";
import styles from "./panel-header.module.css";

interface PanelHeaderProps {
  onOpenMainWindow: () => void;
}

/** Capture Panel chrome: the Kaipu mark, app name, and "Open ↗". */
export function PanelHeader({ onOpenMainWindow }: PanelHeaderProps): React.JSX.Element {
  return (
    <div className={styles.header}>
      <div className={styles.brand}>
        <span className={styles.mark}>
          <KaipuMark size={16} />
        </span>
        <span className={styles.name}>Kaipu Record</span>
      </div>
      <button type="button" className={styles.openButton} onClick={onOpenMainWindow}>
        Open ↗
      </button>
    </div>
  );
}
