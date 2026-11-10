import React from "react";
import {
  AppWindow,
  Camera,
  CameraOff,
  Frame,
  Loader2,
  Mic,
  MicOff,
  Monitor,
  Pause,
  Play,
  Square,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { formatElapsed } from "@renderer/features/recording/elapsed";
import { cx } from "@renderer/ui/cx";
import type { RecordingTick } from "@shared/types/ipc";
import type { CaptureMode } from "@shared/types/screenshot-capture";
import styles from "./control-bar.module.css";
import { uiArea } from "@renderer/lib/ui-area";

interface ControlBarProps {
  tick: RecordingTick;
  onPause(): void;
  onResume(): void;
  onStop(): void;
  /** The real (rebindable) Stop shortcut label, e.g. "⌃⌘S". */
  stopShortcut?: string;
  /** What is recorded: the mode and, for an area drawn with one, its ratio ("16:9"). */
  modeChip?: { mode: CaptureMode; ratio: string | null };
  inputs?: {
    microphone: boolean;
    systemAudio: boolean;
    camera: boolean;
    loaded: boolean;
    onMicrophoneToggle(): void;
    onSystemAudioToggle(): void;
    onCameraToggle(): void;
  };
  onScreenshot?(): void;
  screenshotShortcut?: string;
}

const MODE_ICON = { frame: Frame, window: AppWindow, screen: Monitor } as const;

/**
 * Floating recording HUD: timer, live levels, recorded target, screenshot, input toggles,
 * pause/resume and stop. Controls stay out of the captured video by default.
 */
export function ControlBar({
  tick,
  onPause,
  onResume,
  onStop,
  stopShortcut,
  modeChip,
  inputs,
  onScreenshot,
  screenshotShortcut,
}: ControlBarProps): React.JSX.Element {
  const t = useTranslations("panel");
  const tModes = useTranslations("screenshots");
  const tRecord = useTranslations("record");
  if (tick.status === "saving") {
    return (
      <div {...uiArea("controlBar.bar")} className={styles.bar}>
        <Loader2 size={16} className={styles.spinner} />
        <span className={styles.savingLabel}>{t("saving")}</span>
      </div>
    );
  }

  if (tick.status === "starting") {
    // The streams are still being acquired: nothing is recorded yet, so no timer, no level
    // and no pause. Stop stays, and cancels the pending start.
    return (
      <div {...uiArea("controlBar.bar")} className={styles.bar}>
        <span className={styles.dot} data-starting />
        <span className={styles.savingLabel}>{t("starting")}</span>
        {modeChip && <ModeChip chip={modeChip} label={modeName(modeChip.mode, tModes)} />}
        <button
          className={styles.stop}
          type="button"
          aria-label={t("stop")}
          title={[t("stop"), stopShortcut].filter(Boolean).join(" · ")}
          onClick={onStop}
        >
          <Square size={14} fill="currentColor" />
        </button>
      </div>
    );
  }

  const paused = tick.status === "paused";
  return (
    <div {...uiArea("controlBar.bar")} className={styles.bar} data-paused={paused || undefined}>
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

      {onScreenshot && (
        <button
          {...uiArea("controlBar.screenshot")}
          className={styles.control}
          type="button"
          aria-label={t("screenshot")}
          title={[t("screenshot"), screenshotShortcut].filter(Boolean).join(" · ")}
          onClick={onScreenshot}
        >
          <span className={styles.screenshotIcon} aria-hidden="true" />
        </button>
      )}
      {inputs && (
        <div {...uiArea("controlBar.inputs")} className={styles.inputs}>
          <InputToggle
            label={tRecord("micLabel")}
            enabled={inputs.microphone}
            disabled={!inputs.loaded}
            onClick={inputs.onMicrophoneToggle}
            icon={inputs.microphone ? Mic : MicOff}
          />
          <InputToggle
            label={tRecord("audioLabel")}
            enabled={inputs.systemAudio}
            disabled={!inputs.loaded || tick.systemAudioAvailable === false}
            title={tick.systemAudioAvailable === false ? tRecord("audioUnavailable") : undefined}
            onClick={inputs.onSystemAudioToggle}
            icon={inputs.systemAudio ? Volume2 : VolumeX}
          />
          <InputToggle
            label={tRecord("cameraLabel")}
            enabled={inputs.camera}
            disabled={!inputs.loaded}
            onClick={inputs.onCameraToggle}
            icon={inputs.camera ? Camera : CameraOff}
          />
        </div>
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
      <button
        className={styles.stop}
        type="button"
        aria-label={t("stop")}
        title={[t("stop"), stopShortcut].filter(Boolean).join(" · ")}
        onClick={onStop}
      >
        <Square size={14} fill="currentColor" />
      </button>
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
    <span {...uiArea("controlBar.mode")} className={styles.modeChip} data-testid="control-bar-mode">
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

function InputToggle({
  label,
  enabled,
  disabled,
  title,
  onClick,
  icon: Icon,
}: {
  label: string;
  enabled: boolean;
  disabled: boolean;
  title?: string;
  onClick(): void;
  icon: typeof Mic;
}): React.JSX.Element {
  return (
    <button
      className={cx(styles.control, styles.input)}
      type="button"
      aria-label={label}
      aria-pressed={enabled}
      disabled={disabled}
      title={title ?? label}
      onClick={onClick}
    >
      <Icon size={17} aria-hidden />
    </button>
  );
}
