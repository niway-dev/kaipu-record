import React from "react";
import { Loader2 } from "lucide-react";
import styles from "./countdown-overlay.module.css";

interface CountdownOverlayProps {
  /**
   * The number shown in the center; re-rendering it re-triggers the pop. `null`
   * means the count finished and streams are being acquired — show a spinner so
   * the blocking overlay stays up until the window hands off to the floating bar.
   */
  value: number | null;
}

/** Full-screen dimmed overlay: the large countdown number, or a starting spinner. */
export function CountdownOverlay({ value }: CountdownOverlayProps): React.JSX.Element {
  return (
    <div className={styles.overlay} role="status" aria-live="assertive">
      {value !== null ? (
        <span key={value} className={styles.number}>
          {value}
        </span>
      ) : (
        <Loader2 className={styles.spinner} size={56} />
      )}
    </div>
  );
}
