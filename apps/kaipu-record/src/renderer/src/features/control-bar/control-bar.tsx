import React from "react";
import { Pause, Play, Square } from "lucide-react";
import { formatElapsed } from "@renderer/features/recording/elapsed";
import { cx } from "@renderer/ui/cx";
import type { RecordingTick } from "@shared/types/ipc";
import styles from "./control-bar.module.css";

interface ControlBarProps {
  tick: RecordingTick;
  onPause(): void;
  onResume(): void;
  onStop(): void;
}

/** The floating recording HUD: status dot · mono timer · live mic level · pause/resume · stop. */
export function ControlBar({
  tick,
  onPause,
  onResume,
  onStop,
}: ControlBarProps): React.JSX.Element {
  const paused = tick.status === "paused";
  return (
    <div className={styles.bar} data-paused={paused || undefined}>
      <span className={styles.dot} data-paused={paused || undefined} />
      {paused ? (
        <span className={styles.pausedLabel}>Paused</span>
      ) : (
        <MicLevel levels={tick.levels} />
      )}
      <span className={styles.time}>{formatElapsed(tick.elapsedSeconds * 1000)}</span>
      <div className={styles.divider} />
      {paused ? (
        <button className={styles.control} aria-label="Resume" onClick={onResume}>
          <Play size={15} />
        </button>
      ) : (
        <button className={styles.control} aria-label="Pause" onClick={onPause}>
          <Pause size={15} />
        </button>
      )}
      <button className={styles.stop} aria-label="Stop" onClick={onStop}>
        <Square size={13} fill="currentColor" />
      </button>
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
