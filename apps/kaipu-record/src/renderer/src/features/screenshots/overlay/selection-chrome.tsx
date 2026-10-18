import { AppWindow, Camera, Circle, Copy, Frame, Monitor, X, type LucideIcon } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import {
  type CaptureAction,
  type CaptureMode,
  type CaptureRect,
} from "@shared/types/screenshot-capture";
import { copyKeyLabel, type KeyPlatform } from "./overlay-keys";
import styles from "./capture-overlay.module.css";

/** Gap between the selection and the pill / the action bar attached to it. */
export const CHROME_GAP_DIP = 10;
/** The pill's own width; the active mode's label tag sticks out beyond it. */
export const PILL_WIDTH_DIP = 44;
/** Room the pill plus its label tag needs beside the selection before it flips side. */
export const PILL_ROOM_DIP = 120;
/** The pill's height: three modes, a divider and Cancel. */
export const PILL_HEIGHT_DIP = 170;
/** The action bar's height and (about) its width. */
export const BAR_HEIGHT_DIP = 44;
export const BAR_WIDTH_DIP = 330;

export const MODE_ICON: Record<CaptureMode, LucideIcon> = {
  frame: Frame,
  window: AppWindow,
  screen: Monitor,
};

/** What every mode's UI needs to draw the pill and the bar and to switch mode. */
export interface OverlayChrome {
  mode: CaptureMode;
  /** The modes the pill and the Screen card row offer, in order (keys 1..n). */
  modes: readonly CaptureMode[];
  platform: KeyPlatform;
  /** Switch every overlay to `mode` (the pill, the Screen card row). */
  onMode(mode: CaptureMode): void;
  /** The pill's Cancel button: the same as Esc. */
  onCancel(): void;
}

export type Placement<Side extends string> = { side: Side; left: number; top: number };

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/**
 * The mode pill: 10 DIP right of the selection's top-right corner; on its left when there is
 * no room on the right; inside the selection's right edge only when neither side has room.
 * `area` is the work area in window coordinates.
 */
export function pillPlacement(
  selection: CaptureRect,
  area: CaptureRect,
): Placement<"right" | "left" | "inside"> {
  const top = clamp(selection.y, area.y, area.y + area.height - PILL_HEIGHT_DIP);
  const right = selection.x + selection.width + CHROME_GAP_DIP;
  if (right + PILL_ROOM_DIP <= area.x + area.width) return { side: "right", left: right, top };
  if (selection.x - CHROME_GAP_DIP - PILL_ROOM_DIP >= area.x) {
    return { side: "left", left: selection.x - CHROME_GAP_DIP - PILL_WIDTH_DIP, top };
  }
  return { side: "inside", left: right - 2 * CHROME_GAP_DIP - PILL_WIDTH_DIP, top };
}

/**
 * The action bar: 10 DIP below the selection's bottom-left corner; above it when there is
 * no room below. It never covers the selection, unless the selection leaves no room on
 * either side (a box the size of the work area): then it sits inside the bottom edge.
 */
export function barPlacement(
  selection: CaptureRect,
  area: CaptureRect,
): Placement<"below" | "above" | "inside"> {
  const left = clamp(selection.x, area.x, area.x + area.width - BAR_WIDTH_DIP);
  const below = selection.y + selection.height + CHROME_GAP_DIP;
  if (below + BAR_HEIGHT_DIP <= area.y + area.height) return { side: "below", left, top: below };
  const above = selection.y - CHROME_GAP_DIP - BAR_HEIGHT_DIP;
  if (above >= area.y) return { side: "above", left, top: above };
  return { side: "inside", left, top: below - 2 * CHROME_GAP_DIP - BAR_HEIGHT_DIP };
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

/** Every mode's label, as the pill and the Screen card's row print them. */
function useModeLabels(): Record<CaptureMode, string> {
  const t = useTranslations("screenshots");
  return { frame: t("modeFrame"), window: t("modeWindow"), screen: t("modeScreen") };
}

/**
 * The vertical mode pill attached to the selection: the enabled modes (Frame · Screen while Window is off) with their 1/2/.. badges, the active one filled with the accent and tagged with its name, then Cancel.
 */
export function ModePill({
  chrome,
  selection,
  area,
}: {
  chrome: OverlayChrome;
  selection: CaptureRect;
  area: CaptureRect;
}): React.JSX.Element {
  const t = useTranslations("screenshots");
  const labels = useModeLabels();
  const { side, left, top } = pillPlacement(selection, area);
  return (
    <div
      role="toolbar"
      aria-orientation="vertical"
      aria-label={t("overlay.modes")}
      data-testid="mode-pill"
      data-side={side}
      className={styles.modePill}
      style={{ left, top }}
      {...keepPointer}
    >
      {chrome.modes.map((mode, index) => {
        const Icon = MODE_ICON[mode];
        const active = mode === chrome.mode;
        return (
          <button
            key={mode}
            type="button"
            className={styles.modeButton}
            aria-pressed={active}
            aria-label={t("overlay.modeKey", { mode: labels[mode], key: index + 1 })}
            onClick={() => chrome.onMode(mode)}
          >
            <Icon size={16} aria-hidden />
            <span className={styles.modeBadge} aria-hidden>
              {index + 1}
            </span>
            {active && (
              <span className={styles.modeTag} aria-hidden>
                {labels[mode]}
              </span>
            )}
          </button>
        );
      })}
      <span className={styles.pillDivider} aria-hidden />
      <button
        type="button"
        className={styles.modeButton}
        aria-label={t("overlay.cancel")}
        onClick={chrome.onCancel}
      >
        <X size={16} aria-hidden />
      </button>
    </div>
  );
}

/**
 * The horizontal action bar attached to the selection: Capture (Enter), Copy (⌘C / Ctrl+C),
 * and the reserved, disabled Record seat, which answers nothing.
 */
export function ActionBar({
  platform,
  selection,
  area,
  onAction,
}: {
  platform: KeyPlatform;
  selection: CaptureRect;
  area: CaptureRect;
  onAction(action: CaptureAction): void;
}): React.JSX.Element {
  const t = useTranslations("screenshots");
  const { side, left, top } = barPlacement(selection, area);
  return (
    <div
      role="toolbar"
      aria-label={t("overlay.capture")}
      data-testid="action-bar"
      data-side={side}
      className={styles.actionBar}
      style={{ left, top }}
      {...keepPointer}
    >
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
          {copyKeyLabel(platform)}
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
    </div>
  );
}

/** The Screen card's segmented row: the same modes as the pill. */
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
