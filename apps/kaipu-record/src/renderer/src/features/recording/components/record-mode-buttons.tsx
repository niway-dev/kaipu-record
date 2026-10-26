import React from "react";
import { AppWindow, Frame, Monitor, type LucideIcon } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import {
  CAPTURE_MODES,
  type CaptureMode,
  type RememberedArea,
} from "@shared/types/screenshot-capture";
// The same chips and primary button as the screenshot entry points, so both read as one model.
import styles from "@renderer/features/screenshots/capture-mode-buttons.module.css";
import own from "./record-mode-buttons.module.css";

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

interface RecordModeButtonsProps {
  /** `panel`: the tray's button, compact chips and footnote. `page`: the Record page card. */
  variant: "panel" | "page";
  /** The last used mode: the chip marked current, and the mode Start opens. */
  mode: CaptureMode;
  /** The remembered Frame area, described beside the chips while Frame is current. */
  area: RememberedArea | null;
  /** The `startRecording` shortcut as a label ("⌃⌘C"); hidden when missing. */
  shortcut?: string;
  /** Open the selector in the last used mode. */
  onStart(): void;
  /** Open the selector straight in `mode` (which becomes the last used one). */
  onPick(mode: CaptureMode): void;
  /** What sits under the chips: the sound and camera inputs (before the panel's footnote). */
  children?: React.ReactNode;
}

/**
 * The recording entry points (design "Kaipu Record Modes"): "Start recording" opens the
 * selector in the last used mode, and the Frame · Window · Screen chips jump straight into
 * one. All three modes are offered: Window opens the thumbnail picker while the overlay's
 * Window mode is off (NIW2-469). Nothing here starts a take by itself.
 */
export function RecordModeButtons({
  variant,
  mode,
  area,
  shortcut,
  onStart,
  onPick,
  children,
}: RecordModeButtonsProps): React.JSX.Element {
  const t = useTranslations("record");
  const tModes = useTranslations("screenshots");
  const name = (value: CaptureMode): string => tModes(MODE_LABEL[value]);
  const ratio = area?.ratio && area.ratio !== "free" ? area.ratio : t("ratioFree");

  const primary = (
    <button type="button" className={`${styles.primary} ${own.primary}`} onClick={onStart}>
      <span className={own.dot} aria-hidden />
      <span>{t("startRecording")}</span>
      {shortcut && <kbd className={styles.primaryShortcut}>{shortcut}</kbd>}
    </button>
  );

  const chips = CAPTURE_MODES.map((value) => {
    const Icon = MODE_ICON[value];
    const isCurrent = value === mode;
    return (
      <button
        key={value}
        type="button"
        className={styles.chip}
        data-current={isCurrent || undefined}
        aria-pressed={isCurrent}
        title={t("modeChipTitle", { mode: name(value) })}
        onClick={() => onPick(value)}
      >
        <Icon size={variant === "page" ? 15 : 14} aria-hidden />
        <span>{name(value)}</span>
        {isCurrent && <span className={styles.currentDot} aria-hidden />}
      </button>
    );
  });

  if (variant === "panel") {
    const last = mode === "frame" && area ? `${name(mode)} · ${ratio}` : name(mode);
    return (
      <div className={styles.panel}>
        {primary}
        <div className={styles.chips}>{chips}</div>
        {children}
        <p className={styles.trayHint}>{t("lastUsedNote", { mode: last })}</p>
      </div>
    );
  }

  return (
    <section className={styles.hero}>
      <div className={styles.heroTop}>
        {primary}
        <p className={styles.heroHint}>{t("startHelper")}</p>
      </div>
      <div className={styles.lastUsed}>
        <span className={styles.lastUsedLabel}>{t("lastUsed")}</span>
        <div className={styles.chips}>{chips}</div>
        {mode === "frame" && area && (
          <span className={own.caption} data-testid="frame-caption">
            {t("frameCaption", { ratio, width: area.width, height: area.height })}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}
