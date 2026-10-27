import {
  AppWindow,
  Camera,
  Circle,
  Copy,
  Frame,
  Monitor,
  Video,
  X,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import {
  type CaptureAction,
  type CaptureIntent,
  type CaptureMode,
  type CaptureRect,
} from "@shared/types/screenshot-capture";
import { copyKeyLabel, recordKeyLabel, type KeyPlatform } from "./overlay-keys";
import type { OverlayToggles } from "./record-chrome";
import styles from "./capture-overlay.module.css";

/** Gap between the selection and the toolbar attached to it. */
export const CHROME_GAP_DIP = 10;
/** The toolbar's height. */
export const TOOLBAR_HEIGHT_DIP = 44;
/**
 * What the toolbar occupies besides its mode buttons (about: the Capture | Record switch,
 * Capture, Copy, Cancel, dividers; Record only in the record intent).
 */
export const TOOLBAR_BASE_WIDTH_DIP = 540;
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
  /**
   * Why the overlay opened. `capture`: Capture is primary, with Copy beside it and no Record (the P / V switch covers it).
   * `record`: Frame and Screen draw their own record chrome (Start recording, Enter).
   */
  intent: CaptureIntent;
  /** Switch every overlay to `mode` (the toolbar, the Screen card row). */
  onMode(mode: CaptureMode): void;
  /** The toolbar's Cancel button: the same as Esc. */
  onCancel(): void;
  /**
   * Switch between taking a screenshot and recording without leaving the overlay (the
   * Capture | Record switch, keys P and V). The selection and the mode stay as they are.
   */
  onIntent?(intent: CaptureIntent): void;
  /**
   * Mic, System audio and Camera as main holds them: the record intent's widget and Screen
   * card toggle them in place. Absent outside the record intent.
   */
  toggles?: OverlayToggles;
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
 * on wide selections, key badge), the actions of the overlay's intent (see `ActionButtons`),
 * and Cancel (Esc). `canRecord` false (a selection under the recording minimum) disables
 * Record (record intent); Capture and Copy stay.
 */
export function SelectionToolbar({
  chrome,
  selection,
  area,
  onAction,
  canRecord = true,
}: {
  chrome: OverlayChrome;
  selection: CaptureRect;
  area: CaptureRect;
  onAction(action: CaptureAction): void;
  canRecord?: boolean;
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
      <IntentSwitch chrome={chrome} />
      <span className={styles.barDivider} aria-hidden />
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
      <ActionButtons chrome={chrome} onAction={onAction} canRecord={canRecord} />
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

/**
 * The two-state Capture | Record switch (camera and video icons, keys P and V), from the
 * owner's "Kaipu Unified Capture" design: it changes only what the confirm actions do, never
 * the selection or the mode. Drawn in the horizontal toolbar, the Screen card and, stacked,
 * in the record intent's widget.
 */
export function IntentSwitch({
  chrome,
  vertical = false,
}: {
  chrome: OverlayChrome;
  vertical?: boolean;
}): React.JSX.Element | null {
  const t = useTranslations("screenshots");
  if (!chrome.onIntent) return null;
  const options = [
    { intent: "capture", icon: Camera, label: t("overlay.intentCapture") },
    { intent: "record", icon: Video, label: t("overlay.intentRecord") },
  ] as const;
  return (
    <div
      role="group"
      aria-label={t("overlay.intent")}
      data-testid="intent-switch"
      className={vertical ? styles.intentSwitchVertical : styles.intentSwitch}
      {...keepPointer}
    >
      {options.map(({ intent, icon: Icon, label }) => (
        <button
          key={intent}
          type="button"
          className={vertical ? styles.widgetMode : styles.intentOption}
          aria-pressed={chrome.intent === intent}
          aria-label={label}
          title={label}
          onClick={() => chrome.onIntent?.(intent)}
        >
          <Icon size={vertical ? 16 : 15} aria-hidden />
          <span className={styles.widgetDigit} aria-hidden>
            {intent === "capture" ? "P" : "V"}
          </span>
        </button>
      ))}
    </div>
  );
}

/**
 * The action buttons for the overlay's intent, shared by the selection toolbar and the
 * Screen card. Opened to capture: Capture (Enter) · Copy (⌘C), with no Record: the P / V
 * switch beside the modes already turns the same selection into a recording. Opened to
 * record (the Window picker only): Record (R) | Capture (click only, so ⌘C keeps meaning
 * copy everywhere else in the app).
 */
export function ActionButtons({
  chrome,
  onAction,
  canRecord = true,
  captureLabel,
}: {
  chrome: OverlayChrome;
  onAction(action: CaptureAction): void;
  canRecord?: boolean;
  /** The Screen card names its Capture button after the display ("Capture · 2"). */
  captureLabel?: { text: string; aria: string };
}): React.JSX.Element {
  const t = useTranslations("screenshots");
  const capture = (primary: boolean): React.JSX.Element => (
    <button
      type="button"
      className={primary ? styles.captureButton : styles.copyButton}
      aria-label={captureLabel?.aria ?? t("overlay.capture")}
      onClick={() => onAction("capture")}
    >
      <Camera size={14} aria-hidden />
      {captureLabel?.text ?? t("overlay.capture")}
      {primary && (
        <kbd className={styles.kbd} aria-hidden>
          ↩
        </kbd>
      )}
    </button>
  );
  const record = () => (
    <button
      type="button"
      className={styles.recordButton}
      aria-label={t("overlay.record")}
      disabled={!canRecord}
      onClick={() => onAction("record")}
    >
      <Circle size={12} aria-hidden />
      {t("overlay.record")}
      <kbd className={styles.kbd} aria-hidden>
        {recordKeyLabel(chrome.platform)}
      </kbd>
    </button>
  );
  if (chrome.intent === "record") {
    // Only the Window picker still draws this bar opened to record (Frame and Screen have
    // their own record chrome): Record first, Capture beside it, no "Use selection".
    return (
      <>
        {record()}
        <span className={styles.barDivider} aria-hidden />
        {capture(false)}
      </>
    );
  }
  return (
    <>
      {capture(true)}
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
    </>
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
