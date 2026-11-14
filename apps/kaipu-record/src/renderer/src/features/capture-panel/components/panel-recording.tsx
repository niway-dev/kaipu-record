import React from "react";
import { useTranslations } from "@kaipu/i18n";
import { uiArea } from "@renderer/lib/ui-area";
import styles from "./panel-recording.module.css";

/** m:ss, or h:mm:ss past the hour: the tray has room for a clock, not for 00:00:42. */
export function formatClock(totalSeconds: number): string {
  const total = Math.max(0, Math.floor(totalSeconds));
  const seconds = String(total % 60).padStart(2, "0");
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
    : `${minutes}:${seconds}`;
}

interface RecordingStatusProps {
  /** The countdown or the first frames: nothing is recorded yet, so no clock. */
  starting: boolean;
  paused: boolean;
  /** The last used recording mode's name, shown as "Recording · {mode}". */
  mode: string;
  elapsedSeconds: number;
}

/** The tray's status box while a take runs: a pulsing dot, what it is doing, and the clock. */
export function RecordingStatus({
  starting,
  paused,
  mode,
  elapsedSeconds,
}: RecordingStatusProps): React.JSX.Element {
  const t = useTranslations("panel");
  const label = starting ? t("starting") : paused ? t("paused") : t("recordingMode", { mode });
  return (
    <div
      {...uiArea("capturePanel.recordingStatus")}
      className={styles.status}
      role="status"
      data-paused={paused || undefined}
    >
      <span className={styles.dot} aria-hidden />
      <div className={styles.text}>
        <div className={styles.label}>{label}</div>
        {!starting && <div className={styles.clock}>{formatClock(elapsedSeconds)}</div>}
      </div>
    </div>
  );
}

interface StopButtonProps {
  /** The `startRecording` binding as a label ("⇧⌘2"); it toggles, so it stops too. */
  shortcut?: string;
  onStop(): void;
}

/** Full-width Stop (also cancels a countdown): the recording runs in another window. */
export function StopButton({ shortcut, onStop }: StopButtonProps): React.JSX.Element {
  const t = useTranslations("panel");
  return (
    <button
      {...uiArea("capturePanel.stopButton")}
      type="button"
      className={styles.stop}
      onClick={onStop}
    >
      <span className={styles.square} aria-hidden />
      <span>{t("stop")}</span>
      {shortcut && <span className={styles.shortcut}>{shortcut}</span>}
    </button>
  );
}
