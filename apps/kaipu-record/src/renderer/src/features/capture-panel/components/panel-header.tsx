import React from "react";
import styles from "./panel-header.module.css";

interface PanelHeaderProps {
  isRecording: boolean;
  onOpenMainWindow: () => void;
}

/** Capture Panel chrome: recording indicator, app name, and "Open ↗". */
export function PanelHeader({
  isRecording,
  onOpenMainWindow,
}: PanelHeaderProps): React.JSX.Element {
  return (
    <div className={styles.header}>
      <div className={styles.brand}>
        <span className={[styles.indicator, isRecording ? styles.indicatorActive : ""].join(" ")}>
          <span className={styles.ring} />
        </span>
        <span className={styles.name}>Kaipu Record</span>
      </div>
      <button type="button" className={styles.openButton} onClick={onOpenMainWindow}>
        Open ↗
      </button>
    </div>
  );
}
