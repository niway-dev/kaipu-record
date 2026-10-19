import React from "react";
import { AppWindow, Camera, CircleDot, Frame, Monitor, type LucideIcon } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { formatElapsed } from "@renderer/features/recording/elapsed";
import type { ShortcutLabels } from "@renderer/features/shortcuts/use-shortcut-labels";
import { ENABLED_CAPTURE_MODES, type CaptureMode } from "@shared/types/screenshot-capture";
import { useScreenshotMode } from "./use-screenshot-mode";
import { useSupportedCaptureModes } from "./use-supported-capture-modes";
import styles from "./capture-mode-buttons.module.css";

const MODE_ICON: Record<CaptureMode, LucideIcon> = {
  frame: Frame,
  window: AppWindow,
  screen: Monitor,
};

const MODE_LABEL = {
  frame: "modeFrame",
  window: "modeWindow",
  screen: "modeScreen",
} as const satisfies Record<CaptureMode, string>;

/** A recording in progress: everything is paused, and the page offers to stop it. */
export interface PickerRecording {
  elapsedSeconds: number;
}

interface CaptureModeButtonsProps {
  /** `panel`: the tray's button and compact chips. `page`: the Screenshots page hero. */
  variant: "panel" | "page";
  /** Capture now in `mode`: the Capture button passes the current mode, a chip its own. */
  onCapture: (mode: CaptureMode) => void;
  /** Current bindings as display labels; a missing one just hides that hint. */
  shortcuts: ShortcutLabels | null;
  /** Set while a recording runs: every entry point is paused and a banner says why. */
  recording?: PickerRecording | null;
  /** The page banner's "Stop recording" link; omitted, the link is not shown. */
  onStopRecording?: () => void;
  /** The chips on offer; defaults to `ENABLED_CAPTURE_MODES` (Window is off). */
  enabledModes?: readonly CaptureMode[];
}

/**
 * The screenshot entry points, shared by the tray panel and the Screenshots page: one
 * Capture button that opens the selector in the last-used mode, and a row of chips (Frame,
 * Screen; Window while it is enabled) that open it directly in that mode.
 *
 * Neither writes the mode: main remembers it when a capture completes, so a chip click
 * that is cancelled changes nothing. The current chip is only a reminder of the mode the
 * Capture button will use.
 *
 * A mode the platform cannot serve (today only when its provider serves nothing, or main
 * cannot be asked) stays visible but disabled, with the reason in place of its shortcut.
 */
export function CaptureModeButtons({
  variant,
  onCapture,
  shortcuts,
  recording = null,
  onStopRecording,
  enabledModes = ENABLED_CAPTURE_MODES,
}: CaptureModeButtonsProps): React.JSX.Element {
  const t = useTranslations("screenshots");
  const supported = useSupportedCaptureModes();
  const { mode: current } = useScreenshotMode(enabledModes);

  // Until main answers, keep everything enabled: the capture itself still answers
  // `unsupported` safely, and a flash of disabled buttons on every open is worse.
  const available = (mode: CaptureMode): boolean => supported === null || supported.includes(mode);
  const busy = recording !== null;
  const name = (mode: CaptureMode): string => t(MODE_LABEL[mode]);
  const shortcutFor = (mode: CaptureMode): string | undefined =>
    mode === "frame"
      ? shortcuts?.captureFrame
      : mode === "window"
        ? shortcuts?.captureWindow
        : shortcuts?.captureScreen;

  const elapsed = recording ? formatElapsed(recording.elapsedSeconds * 1000) : "";

  const primary = (
    <button
      type="button"
      className={styles.primary}
      disabled={busy || !available(current)}
      onClick={() => onCapture(current)}
    >
      <Camera size={variant === "page" ? 18 : 16} aria-hidden />
      <span>{t("captureButton")}</span>
      {shortcuts?.captureScreenshot && (
        <kbd className={styles.primaryShortcut}>{shortcuts.captureScreenshot}</kbd>
      )}
    </button>
  );

  const chips = enabledModes.map((mode) => {
    const Icon = MODE_ICON[mode];
    const isAvailable = available(mode);
    const isCurrent = mode === current && !busy;
    const shortcut = shortcutFor(mode);
    return (
      <button
        key={mode}
        type="button"
        className={styles.chip}
        data-current={isCurrent || undefined}
        data-unavailable={!isAvailable || undefined}
        disabled={busy || !isAvailable}
        title={isAvailable ? undefined : t("notAvailable")}
        onClick={() => onCapture(mode)}
      >
        <Icon size={variant === "page" ? 15 : 14} aria-hidden />
        <span>{name(mode)}</span>
        {isCurrent && <span className={styles.currentDot} aria-hidden />}
        {variant === "page" &&
          (!isAvailable ? (
            <span className={styles.reason}>{t("notAvailable")}</span>
          ) : (
            shortcut && <kbd className={styles.kbd}>{shortcut}</kbd>
          ))}
      </button>
    );
  });

  if (variant === "panel") {
    const noneAvailable = supported !== null && supported.length === 0;
    return (
      <div className={styles.panel} data-busy={busy || undefined}>
        {recording && (
          <div className={styles.trayBanner} role="status">
            <CircleDot size={14} className={styles.recIcon} aria-hidden />
            <span>
              <b>{t("trayRecordingLead", { elapsed })}</b> {t("trayRecordingBody")}
            </span>
          </div>
        )}
        {primary}
        <div className={styles.chips}>{chips}</div>
        <p className={styles.trayHint}>
          {noneAvailable ? t("notAvailable") : t("trayLastUsed", { mode: name(current) })}
        </p>
      </div>
    );
  }

  return (
    <section className={styles.hero} data-busy={busy || undefined}>
      {recording && (
        <div className={styles.banner} role="status">
          <CircleDot size={16} className={styles.recIcon} aria-hidden />
          <p className={styles.bannerText}>
            <b>{t("recordingBannerLead", { elapsed })}</b> {t("recordingBannerBody")}
          </p>
          {onStopRecording && (
            <button type="button" className={styles.bannerLink} onClick={onStopRecording}>
              {t("stopRecording")}
            </button>
          )}
        </div>
      )}
      <div className={styles.heroTop}>
        {primary}
        <p className={styles.heroHint}>{busy ? t("pickerHintRecording") : t("heroHint")}</p>
      </div>
      <div className={styles.lastUsed}>
        <span className={styles.lastUsedLabel}>{t("lastUsed")}</span>
        <div className={styles.chips}>{chips}</div>
      </div>
    </section>
  );
}
