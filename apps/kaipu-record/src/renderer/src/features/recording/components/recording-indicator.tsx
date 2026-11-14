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
  ui?: UiAreaProps;
}

/** The "● Recording / Paused + timer" strip at the top of the Record page while a take runs. */
export function RecordingIndicator({
  paused,
  elapsedSeconds,
  ui,
}: RecordingIndicatorProps): React.JSX.Element {
  const t = useTranslations("record");
  return (
    <div {...ui} className={styles.bar} data-paused={paused || undefined}>
      <span className={styles.dot} data-paused={paused || undefined} />
      <span className={styles.label}>{paused ? t("pausedState") : t("recordingState")}</span>
      <span className={styles.timer}>{formatElapsed(elapsedSeconds * 1000)}</span>
    </div>
  );
}
