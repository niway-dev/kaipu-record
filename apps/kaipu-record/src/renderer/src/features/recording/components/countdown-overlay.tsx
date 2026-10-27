import React, { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@kaipu/ui";
import type { CaptureRect } from "@shared/types/screenshot-capture";
import styles from "./countdown-overlay.module.css";

interface CountdownOverlayProps {
  /**
   * The number shown in the center; re-rendering it re-triggers the pop. `null`
   * means the count finished and streams are being acquired — show a spinner so
   * the blocking overlay stays up until the window hands off to the floating bar.
   */
  value: number | null;
  /**
   * Cancels the pending start — wired to Escape and the visible Cancel button. Omit it
   * for the click-through shade window (Frame/area recordings), which cannot take clicks
   * or keys: Escape is a global shortcut held by the main process there, and the `hint`
   * replaces the Cancel button.
   */
  onCancel?: () => void;
  /** Confine the overlay to this region (display-relative DIP) instead of the whole window. */
  region?: CaptureRect | null;
  /** Line shown under the number in place of the Cancel button (only without `onCancel`). */
  hint?: string;
}

/**
 * The one pre-recording countdown, used by every recording path: the large pink number (or
 * a starting spinner) over a dimmed backdrop, full-window or confined to a `region`.
 */
export function CountdownOverlay({
  value,
  onCancel,
  region = null,
  hint,
}: CountdownOverlayProps): React.JSX.Element {
  useEffect(() => {
    if (!onCancel) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  return (
    <div
      className={region ? `${styles.overlay} ${styles.region}` : styles.overlay}
      role="status"
      aria-live="assertive"
      style={
        region
          ? {
              inset: "auto",
              left: region.x,
              top: region.y,
              width: region.width,
              height: region.height,
            }
          : undefined
      }
    >
      {value !== null ? (
        <span key={value} className={styles.number}>
          {value}
        </span>
      ) : (
        <Loader2 className={styles.spinner} size={56} />
      )}
      {onCancel ? (
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      ) : (
        hint && <span className={styles.hint}>{hint}</span>
      )}
    </div>
  );
}
