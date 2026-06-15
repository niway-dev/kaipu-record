import React from "react";
import styles from "./countdown-overlay.module.css";

interface CountdownOverlayProps {
  /** The number shown in the center; re-rendering it re-triggers the pop. */
  value: number;
}

/** Full-screen dimmed overlay with a single large countdown number. */
export function CountdownOverlay({ value }: CountdownOverlayProps): React.JSX.Element {
  return (
    <div className={styles.overlay} role="status" aria-live="assertive">
      <span key={value} className={styles.number}>
        {value}
      </span>
    </div>
  );
}
