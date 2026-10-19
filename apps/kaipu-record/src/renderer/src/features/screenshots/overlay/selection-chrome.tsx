import { AppWindow, Camera, Circle, Copy, Frame, Monitor, X, type LucideIcon } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import {
  type CaptureAction,
  type CaptureMode,
  type CaptureRect,
} from "@shared/types/screenshot-capture";
import { copyKeyLabel, type KeyPlatform } from "./overlay-keys";
import styles from "./capture-overlay.module.css";

/** Gap between the selection and the toolbar attached to it. */
export const CHROME_GAP_DIP = 10;
/** The toolbar's height. */
export const TOOLBAR_HEIGHT_DIP = 44;
/** What the toolbar occupies besides its mode buttons (about: Capture, Copy, Record, Cancel, dividers). */
export const TOOLBAR_BASE_WIDTH_DIP = 460;
/** One mode button with only its icon and key badge. */
export const MODE_BUTTON_DIP = 44;
/** What the mode's name adds to its button when the toolbar is wide enough to print it. */
export const MODE_NAME_DIP = 64;

export const MODE_ICON: Record<CaptureMode, LucideIcon> = {
  frame: Frame,
  window: AppWindow,
  screen: Monitor,
};

/** What every mode's UI needs to draw the toolbar and to switch mode. */
export interface OverlayChrome {
  mode: CaptureMode;
  /** The modes the toolbar and the Screen card row offer, in order (keys 1..n). */
  modes: readonly CaptureMode[];
  platform: KeyPlatform;
  /** Switch every overlay to `mode` (the toolbar, the Screen card row). */
  onMode(mode: CaptureMode): void;
  /** The toolbar's Cancel button: the same as Esc. */
  onCancel(): void;
}

export type Placement<Side extends string> = { side: Side; left: number; top: number };

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/** The toolbar's width for `modeCount` mode buttons, with or without their names. */
export function toolbarWidth(modeCount: number, named: boolean): number {
  return TOOLBAR_BASE_WIDTH_DIP + modeCount * (MODE_BUTTON_DIP + (named ? MODE_NAME_DIP : 0));
}

/**
 * The selection toolbar: centred under the selection's bottom edge, 10 DIP below it; above
 * the top edge when there is no room below; inside the selection at the bottom only when
 * neither side has room (a box the size of the work area). It is clamped horizontally to
 * `area`, the work area in window coordinates, so it never leaves the screen.
 */
export function toolbarPlacement(
  selection: CaptureRect,
  area: CaptureRect,
  width: number,
): Placement<"below" | "above" | "inside"> {
  const left = clamp(
    selection.x + selection.width / 2 - width / 2,
    area.x,
    area.x + area.width - width,
  );
  const below = selection.y + selection.height + CHROME_GAP_DIP;
  if (below + TOOLBAR_HEIGHT_DIP <= area.y + area.height) {
    return { side: "below", left, top: below };
  }
  const above = selection.y - CHROME_GAP_DIP - TOOLBAR_HEIGHT_DIP;
  if (above >= area.y) return { side: "above", left, top: above };
  return { side: "inside", left, top: below - 2 * CHROME_GAP_DIP - TOOLBAR_HEIGHT_DIP };
}

/**
 * Presses, moves and clicks on the chrome stay on the chrome: they must not start a frame
 * drag, change the hovered window, or answer the display underneath.
 */
export const keepPointer = {
  onPointerDown: (event: React.PointerEvent) => event.stopPropagation(),
  onPointerMove: (event: React.PointerEvent) => event.stopPropagation(),
  onClick: (event: React.MouseEvent) => event.stopPropagation(),
};

/** Every mode's label, as the toolbar and the Screen card's row print them. */
function useModeLabels(): Record<CaptureMode, string> {
  const t = useTranslations("screenshots");
  return { frame: t("modeFrame"), window: t("modeWindow"), screen: t("modeScreen") };
}

/**
 * The one horizontal toolbar attached to the selection: the segmented mode group (icon, name
 * on wide selections, key badge),
 * Capture (Enter), Copy (⌘C / Ctrl+C), the reserved, disabled Record seat, and Cancel (Esc).
 */
export function SelectionToolbar({
  chrome,
  selection,
  area,
  onAction,
}: {
  chrome: OverlayChrome;
  selection: CaptureRect;
  area: CaptureRect;
  onAction(action: CaptureAction): void;
}): React.JSX.Element {
  const t = useTranslations("screenshots");
  const labels = useModeLabels();
  // Names only when the toolbar with them is no wider than the selection: a small box keeps
  // the toolbar compact instead of letting it dwarf what it controls.
  const named = selection.width >= toolbarWidth(chrome.modes.length, true);
  const width = toolbarWidth(chrome.modes.length, named);
  const { side, left, top } = toolbarPlacement(selection, area, width);
  return (
    <div
      role="toolbar"
      aria-label={t("overlay.capture")}
      data-testid="selection-toolbar"
      data-side={side}
      className={styles.toolbar}
      style={{ left, top }}
      {...keepPointer}
    >
      <div role="group" aria-label={t("overlay.modes")} className={styles.toolbarModes}>
        {chrome.modes.map((mode, index) => {
          const Icon = MODE_ICON[mode];
          return (
            <button
              key={mode}
              type="button"
              className={styles.toolbarMode}
              aria-pressed={mode === chrome.mode}
              aria-label={t("overlay.modeKey", { mode: labels[mode], key: index + 1 })}
              onClick={() => chrome.onMode(mode)}
            >
              <Icon size={15} aria-hidden />
              {named && <span aria-hidden>{labels[mode]}</span>}
              <span className={styles.modeBadge} aria-hidden>
                {index + 1}
              </span>
            </button>
          );
        })}
      </div>
      <span className={styles.barDivider} aria-hidden />
      <button
        type="button"
        className={styles.captureButton}
        aria-label={t("overlay.capture")}
        onClick={() => onAction("capture")}
      >
        <Camera size={14} aria-hidden />
        {t("overlay.capture")}
        <kbd className={styles.kbd} aria-hidden>
          ↩
        </kbd>
      </button>
      <button
        type="button"
        className={styles.copyButton}
        aria-label={t("overlay.copy")}
        onClick={() => onAction("copy")}
      >
        <Copy size={14} aria-hidden />
        {t("overlay.copy")}
        <kbd className={styles.kbd} aria-hidden>
          {copyKeyLabel(chrome.platform)}
        </kbd>
      </button>
      <span className={styles.barDivider} aria-hidden />
      <button
        type="button"
        className={styles.recordButton}
        aria-label={t("overlay.recordSoon")}
        disabled
      >
        <Circle size={12} aria-hidden />
        {t("overlay.record")}
        <span className={styles.soonTag} aria-hidden>
          {t("overlay.soon")}
        </span>
      </button>
      <span className={styles.barDivider} aria-hidden />
      <button
        type="button"
        className={styles.cancelButton}
        aria-label={t("overlay.cancel")}
        title={t("overlay.cancelTitle")}
        onClick={chrome.onCancel}
      >
        <X size={16} aria-hidden />
      </button>
    </div>
  );
}

/** The Screen card's segmented row: the same modes as the toolbar. */
export function ModeRow({ chrome }: { chrome: OverlayChrome }): React.JSX.Element {
  const t = useTranslations("screenshots");
  const labels = useModeLabels();
  return (
    <div role="group" aria-label={t("overlay.modes")} className={styles.modeRow} {...keepPointer}>
      {chrome.modes.map((mode, index) => {
        const Icon = MODE_ICON[mode];
        return (
          <button
            key={mode}
            type="button"
            className={styles.modeSegment}
            aria-pressed={mode === chrome.mode}
            aria-label={t("overlay.modeKey", { mode: labels[mode], key: index + 1 })}
            onClick={() => chrome.onMode(mode)}
          >
            <Icon size={13} aria-hidden />
            {labels[mode]}
          </button>
        );
      })}
    </div>
  );
}
