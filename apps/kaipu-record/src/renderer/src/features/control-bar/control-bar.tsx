import React from "react";
import { Loader2, Pause, Play, Square } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { formatElapsed } from "@renderer/features/recording/elapsed";
import { cx } from "@renderer/ui/cx";
import type { RecordingTick } from "@shared/types/ipc";
import styles from "./control-bar.module.css";

interface ControlBarProps {
  tick: RecordingTick;
  onPause(): void;
  onResume(): void;
  onStop(): void;
  /** The real (rebindable) Stop shortcut label, e.g. "⌃⌘S". */
  stopShortcut?: string;
}

/** Floating recording HUD: dot · timer · separator · live mic level · pause/resume · stop · shortcut. */
export function ControlBar({
  tick,
  onPause,
  onResume,
  onStop,
  stopShortcut,
}: ControlBarProps): React.JSX.Element {
  const t = useTranslations("panel");
  if (tick.status === "saving") {
    return (
      <div className={styles.bar}>
        <Loader2 size={16} className={styles.spinner} />
        <span className={styles.savingLabel}>{t("saving")}</span>
      </div>
    );
  }

  const paused = tick.status === "paused";
  return (
    <div className={styles.bar} data-paused={paused || undefined}>
      <span className={styles.dot} data-paused={paused || undefined} />
      {paused && <span className={styles.pausedLabel}>{t("paused")}</span>}
      <span className={styles.time}>{formatElapsed(tick.elapsedSeconds * 1000)}</span>

      {!paused && (
        <>
          <span className={styles.divider} />
          <MicLevel levels={tick.levels} />
        </>
      )}

      {paused ? (
        <button
          className={styles.control}
          type="button"
          aria-label={t("resume")}
          onClick={onResume}
        >
          <Play size={17} />
        </button>
      ) : (
        <button className={styles.control} type="button" aria-label={t("pause")} onClick={onPause}>
          <Pause size={17} />
        </button>
      )}
      <button className={styles.stop} type="button" aria-label={t("stop")} onClick={onStop}>
        <Square size={14} fill="currentColor" />
      </button>

      {!paused && stopShortcut && <kbd className={styles.shortcut}>{stopShortcut}</kbd>}
    </div>
  );
}

function MicLevel({ levels }: { levels: number[] }): React.JSX.Element {
  return (
    <div className={styles.meter} aria-hidden>
      {levels.map((value, i) => (
        <span key={i} className={cx(styles.meterBar)} style={{ ["--level" as string]: value }} />
      ))}
    </div>
  );
}
