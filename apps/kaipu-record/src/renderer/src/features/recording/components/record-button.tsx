import React from "react";
import { cx } from "@renderer/ui/cx";
import styles from "./record-button.module.css";

interface RecordButtonProps {
  isRecording: boolean;
  disabled?: boolean;
  shortcut?: string;
  variant?: "full" | "compact";
  onClick: () => void;
}

/** Dumb start/stop button. Recording state comes from `useRecordingSetup`. */
export function RecordButton({
  isRecording,
  disabled = false,
  shortcut,
  variant = "full",
  onClick,
}: RecordButtonProps): React.JSX.Element {
  const compact = variant === "compact";
  return (
    <button
      type="button"
      className={cx(styles.button, compact && styles.compact)}
      data-recording={isRecording || undefined}
      disabled={disabled && !isRecording}
      onClick={onClick}
    >
      <span className={styles.label}>
        <span>{isRecording ? "■" : "●"}</span>
        {isRecording ? "Stop Recording" : "Start Recording"}
      </span>
      {!isRecording && shortcut && <kbd className={styles.shortcut}>{shortcut}</kbd>}
    </button>
  );
}
