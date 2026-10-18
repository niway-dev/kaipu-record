import React from "react";
import { AppWindow, Camera, CircleDot, Frame, Monitor, type LucideIcon } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { formatElapsed } from "@renderer/features/recording/elapsed";
import type { ShortcutLabels } from "@renderer/features/shortcuts/use-shortcut-labels";
import { CAPTURE_MODES, type CaptureMode } from "@shared/types/screenshot-capture";
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

/** The mode every unavailable current mode falls back to. */
const FALLBACK_MODE: CaptureMode = "frame";

/** A recording in progress: everything is paused, and the page offers to stop it. */
export interface PickerRecording {
  elapsedSeconds: number;
}

interface CaptureModeButtonsProps {
  /** `panel`: the tray's button and compact rows. `page`: the Screenshots page hero. */
  variant: "panel" | "page";
  /** Capture with `mode` now. Only the primary button calls it; cards and rows just select. */
  onCapture: (mode: CaptureMode) => void;
  /** Current bindings as display labels; a missing one just hides that hint. */
  shortcuts: ShortcutLabels | null;
  /** Set while a recording runs: every entry point is paused and a banner says why. */
  recording?: PickerRecording | null;
  /** The page banner's "Stop recording" link; omitted, the link is not shown. */
  onStopRecording?: () => void;
}

/**
 * The screenshot mode picker, shared by the tray panel and the Screenshots page: one
 * primary button that captures with the CURRENT mode, and the three modes (Frame, Window,
 * Screen) as cards or rows that only select: clicking one makes it current (remembered)
 * and never captures. The button and the shortcuts capture.
 *
 * A mode the platform cannot serve stays visible but disabled, with the reason in place
 * of its shortcut: hiding it would leave no explanation, and a live button would be a
 * silent no-op. If that mode is the current one, the primary button captures with Frame
 * and says so.
 *
 * Shortcuts: the generic capture shortcut captures with the current mode, so it is shown
 * on the primary button and on whichever mode is current; Frame, Window and
 * Screen also show their own.
 */
export function CaptureModeButtons({
  variant,
  onCapture,
  shortcuts,
  recording = null,
  onStopRecording,
}: CaptureModeButtonsProps): React.JSX.Element {
  const t = useTranslations("screenshots");
  const supported = useSupportedCaptureModes();
  const { mode: storedMode, setMode } = useScreenshotMode();
  const isWindows = /Windows/i.test(navigator.userAgent);
  // Windows is the one platform whose screenshots are announced as upcoming.
  const unavailableLabel = isWindows ? t("comingToWindows") : t("notAvailable");

  // Until main answers, keep everything enabled: the capture itself still answers
  // `unsupported` safely, and a flash of disabled buttons on every open is worse.
  const available = (mode: CaptureMode): boolean => supported === null || supported.includes(mode);
  const current = available(storedMode) || !available(FALLBACK_MODE) ? storedMode : FALLBACK_MODE;
  const fellBack = current !== storedMode;
  const busy = recording !== null;
  const name = (mode: CaptureMode): string => t(MODE_LABEL[mode]);

  const shortcutFor = (mode: CaptureMode): string | undefined => {
    if (mode === current) return shortcuts?.captureScreenshot;
    if (mode === "screen") return shortcuts?.captureScreen;
    if (mode === "frame") return shortcuts?.captureFrame;
    return shortcuts?.captureWindow;
  };

  const hint = busy
    ? t("pickerHintRecording")
    : shortcuts?.captureScreenshot
      ? t("pickerHint", { shortcut: shortcuts.captureScreenshot })
      : t("pickerHintNoShortcut");

  const elapsed = recording ? formatElapsed(recording.elapsedSeconds * 1000) : "";

  const primary = (
    <button
      type="button"
      className={styles.primary}
      disabled={busy || !available(current)}
      onClick={() => onCapture(current)}
    >
      <Camera size={variant === "page" ? 18 : 16} aria-hidden />
      <span>{t("captureCurrent", { mode: name(current) })}</span>
      {shortcuts?.captureScreenshot && (
        <kbd className={styles.primaryShortcut}>{shortcuts.captureScreenshot}</kbd>
      )}
    </button>
  );

  if (variant === "panel") {
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
        <div className={styles.rows}>
          {CAPTURE_MODES.map((mode) => {
            const Icon = MODE_ICON[mode];
            const isAvailable = available(mode);
            const isCurrent = mode === current && !busy;
            const shortcut = shortcutFor(mode);
            return (
              <button
                key={mode}
                type="button"
                className={styles.row}
                data-current={isCurrent || undefined}
                data-unavailable={!isAvailable || undefined}
                disabled={busy || !isAvailable}
                onClick={() => setMode(mode)}
              >
                <Icon size={16} className={styles.rowIcon} aria-hidden />
                <span className={styles.rowName}>{name(mode)}</span>
                {isCurrent && <span className={styles.currentDot} aria-label={t("currentMode")} />}
                {!isAvailable ? (
                  <span className={styles.rowReason}>{unavailableLabel}</span>
                ) : (
                  shortcut && <kbd className={styles.rowShortcut}>{shortcut}</kbd>
                )}
              </button>
            );
          })}
        </div>
        <p className={styles.trayHint}>{t("trayHint")}</p>
      </div>
    );
  }

  const line: Record<CaptureMode, string> = {
    frame: t("modeFrameLine"),
    window: t("modeWindowLine"),
    screen: t("modeScreenLine"),
  };

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
        <p className={styles.heroHint}>{hint}</p>
      </div>
      <div className={styles.cards}>
        {CAPTURE_MODES.map((mode) => {
          const Icon = MODE_ICON[mode];
          const isAvailable = available(mode);
          const isCurrent = mode === current && !busy;
          const shortcut = shortcutFor(mode);
          return (
            <button
              key={mode}
              type="button"
              className={styles.card}
              data-current={isCurrent || undefined}
              data-unavailable={!isAvailable || undefined}
              disabled={busy || !isAvailable}
              onClick={() => setMode(mode)}
            >
              <span className={styles.cardHead}>
                <span className={styles.tile}>
                  <Icon size={16} aria-hidden />
                </span>
                <span className={styles.cardName}>{name(mode)}</span>
                <span className={styles.spacer} />
                {!isAvailable ? (
                  <span className={styles.reason}>{unavailableLabel}</span>
                ) : isCurrent ? (
                  <span className={styles.currentPill}>
                    <span className={styles.currentDot} aria-hidden />
                    {t("currentMode")}
                  </span>
                ) : (
                  shortcut && <kbd className={styles.kbd}>{shortcut}</kbd>
                )}
              </span>
              <span className={styles.cardLine}>{line[mode]}</span>
              <span className={styles.cardFoot}>
                {!isCurrent && isAvailable && !busy && (
                  <span className={styles.hoverPill} aria-hidden>
                    {t("useMode", { mode: name(mode) })}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
      {fellBack && (
        <p className={styles.note}>
          {t(isWindows ? "fallbackNoteWindows" : "fallbackNote", {
            mode: name(storedMode),
            fallback: name(current),
          })}
        </p>
      )}
    </section>
  );
}
