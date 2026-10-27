import React from "react";
import { AppWindow, CameraOff, Frame, Loader2, Monitor, Pause, Play, Square } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { formatElapsed } from "@renderer/features/recording/elapsed";
import { cx } from "@renderer/ui/cx";
import type { RecordingTick } from "@shared/types/ipc";
import type { CaptureMode } from "@shared/types/screenshot-capture";
import styles from "./control-bar.module.css";

interface ControlBarProps {
  tick: RecordingTick;
  onPause(): void;
  onResume(): void;
  onStop(): void;
  /** The real (rebindable) Stop shortcut label, e.g. "⌃⌘S". */
  stopShortcut?: string;
  /** What is recorded: the mode and, for an area drawn with one, its ratio ("16:9"). */
  modeChip?: { mode: CaptureMode; ratio: string | null };
  /**
   * Turn the camera off mid-take. Given only while the camera is on: the bubble hides its
   * own close button during a recording (it would be in the video), and this bar is not.
   */
  onCameraOff?(): void;
}

const MODE_ICON = { frame: Frame, window: AppWindow, screen: Monitor } as const;

/**
 * Floating recording HUD: dot · timer · separator · live mic level · mode · camera off (while
 * the camera is on) · pause/resume · stop · shortcut.
 */
export function ControlBar({
  tick,
  onPause,
  onResume,
  onStop,
  stopShortcut,
  modeChip,
  onCameraOff,
}: ControlBarProps): React.JSX.Element {
  const t = useTranslations("panel");
  const tModes = useTranslations("screenshots");
  const tCamera = useTranslations("cameraSettings");
  if (tick.status === "saving") {
    return (
      <div className={styles.bar}>
        <Loader2 size={16} className={styles.spinner} />
        <span className={styles.savingLabel}>{t("saving")}</span>
      </div>
    );
  }

  if (tick.status === "starting") {
    // The streams are still being acquired: nothing is recorded yet, so no timer, no level
    // and no pause. Stop stays, and cancels the pending start.
    return (
      <div className={styles.bar}>
        <span className={styles.dot} data-starting />
        <span className={styles.savingLabel}>{t("starting")}</span>
        {modeChip && <ModeChip chip={modeChip} label={modeName(modeChip.mode, tModes)} />}
        <button className={styles.stop} type="button" aria-label={t("stop")} onClick={onStop}>
          <Square size={14} fill="currentColor" />
        </button>
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

      {modeChip && <ModeChip chip={modeChip} label={modeName(modeChip.mode, tModes)} />}

      {onCameraOff && (
        <button
          className={styles.control}
          type="button"
          aria-label={tCamera("turnCameraOff")}
          title={tCamera("turnCameraOff")}
          onClick={onCameraOff}
        >
          <CameraOff size={17} />
        </button>
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

function modeName(mode: CaptureMode, t: ReturnType<typeof useTranslations<"screenshots">>): string {
  return mode === "frame" ? t("modeFrame") : mode === "window" ? t("modeWindow") : t("modeScreen");
}

/** The mono mode chip: "16:9" for an area with a ratio, else the mode's name. */
function ModeChip({
  chip,
  label,
}: {
  chip: { mode: CaptureMode; ratio: string | null };
  label: string;
}): React.JSX.Element {
  const Icon = MODE_ICON[chip.mode];
  return (
    <span className={styles.modeChip} data-testid="control-bar-mode">
      <Icon size={12} aria-hidden />
      {chip.ratio ?? label}
    </span>
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
