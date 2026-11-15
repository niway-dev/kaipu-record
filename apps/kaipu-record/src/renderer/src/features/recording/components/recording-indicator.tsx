import React from "react";
import { useTranslations } from "@kaipu/i18n";
import { formatElapsed } from "@renderer/features/recording/elapsed";
import styles from "./recording-indicator.module.css";
import type { UiAreaProps } from "@renderer/lib/ui-area";

interface RecordingIndicatorProps {
  /** Pulsing red while recording, steady amber while paused. */
  paused: boolean;
  /** Captured seconds so far (formatted to HH:MM:SS here). */
  elapsedSeconds: number;
  /** What is being captured ("Entire screen"); omitted when nothing is selected. */
  sourceName?: string;
  /** The Pause/Resume and Stop buttons, drawn after the clock. */
  children?: React.ReactNode;
  ui?: UiAreaProps;
}

/**
 * The recording bar under the Capture page's header while a take runs: dot, "Recording" or
 * "Paused", the source, the clock, then the buttons passed as children.
 */
export function RecordingIndicator({
  paused,
  elapsedSeconds,
  sourceName,
  children,
  ui,
}: RecordingIndicatorProps): React.JSX.Element {
  const t = useTranslations("record");
  return (
    <div {...ui} className={styles.bar} data-paused={paused || undefined}>
      <span className={styles.dot} data-paused={paused || undefined} />
      <span className={styles.label}>{paused ? t("pausedState") : t("recordingState")}</span>
      {sourceName && <span className={styles.source}>{sourceName}</span>}
      <span className={styles.timer}>{formatElapsed(elapsedSeconds * 1000)}</span>
      {children}
    </div>
  );
}
