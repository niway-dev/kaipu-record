import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Camera, Lock, Mic, Volume2, X, type LucideIcon } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import type { KaipuElectronAPI } from "@shared/types/electron-api";
import type { RecordingSettings } from "@shared/types/ipc";
import {
  CAMERA_BUBBLE_WINDOW_PAD,
  DEFAULT_CAMERA_BUBBLE,
  cameraBubbleWindowInArea,
  type CameraBubbleShape,
} from "@shared/camera-bubble";
import { useCameraAccess } from "@renderer/features/camera-settings/use-camera-settings";
import {
  RECORDING_RATIOS,
  type CaptureMode,
  type CaptureRect,
  type RecordingRatio,
} from "@shared/types/screenshot-capture";
import {
  CHROME_GAP_DIP,
  IntentSwitch,
  keepPointer,
  MODE_ICON,
  type OverlayChrome,
} from "./selection-chrome";
import styles from "./capture-overlay.module.css";

/**
 * The chrome of the overlay opened to RECORD (Claude Design "Kaipu Record Modes"): a ratio
 * bar above the Frame box, a vertical widget attached to its right (modes, then Mic,
 * System audio and Camera, then Cancel), a "Start recording ↵" pill under it and, when the
 * camera is on, a placeholder where the camera bubble will sit. Everything is window-local
 * DIP; placements are pure so tests pin them.
 */

/** The vertical widget's footprint: 38 px buttons in a 4 px padded card. */
export const WIDGET_WIDTH_DIP = 48;
export const WIDGET_HEIGHT_DIP = 390;
/** What the active mode's floating label needs to the right of the widget. */
export const WIDGET_LABEL_DIP = 70;
/** The ratio bar's height and its distance above the box. */
export const RATIO_BAR_HEIGHT_DIP = 34;
export const RATIO_BAR_GAP_DIP = 8;
/** The Start pill's height and its gap under the box. */
export const START_PILL_HEIGHT_DIP = 36;
export const START_PILL_GAP_DIP = 14;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/** Above the box, left-aligned; inside its top edge when there is no room above. */
export function ratioBarPlacement(
  frame: CaptureRect,
  area: CaptureRect,
): { left: number; top: number; inside: boolean } {
  const above = frame.y - RATIO_BAR_GAP_DIP - RATIO_BAR_HEIGHT_DIP;
  const inside = above < area.y;
  return {
    left: inside ? frame.x + 8 : frame.x,
    top: inside ? frame.y + 8 : above,
    inside,
  };
}

/**
 * Attached to the box's right edge, 10 DIP out and top-aligned; to its left when the right
 * has no room for the widget and its label; inside the right edge when neither side has.
 * Clamped vertically to the work area.
 */
export function widgetPlacement(
  frame: CaptureRect,
  area: CaptureRect,
): { side: "right" | "left" | "inside"; left: number; top: number } {
  const top = clamp(frame.y, area.y, area.y + area.height - WIDGET_HEIGHT_DIP);
  const right = frame.x + frame.width + CHROME_GAP_DIP;
  if (right + WIDGET_WIDTH_DIP + WIDGET_LABEL_DIP <= area.x + area.width) {
    return { side: "right", left: right, top };
  }
  const left = frame.x - CHROME_GAP_DIP - WIDGET_WIDTH_DIP;
  if (left >= area.x) return { side: "left", left, top };
  return { side: "inside", left: frame.x + frame.width - WIDGET_WIDTH_DIP - 8, top };
}

/** Centred under the box; inside its bottom edge when the work area ends first. */
export function startPillPlacement(
  frame: CaptureRect,
  area: CaptureRect,
): { centerX: number; top: number } {
  const below = frame.y + frame.height + START_PILL_GAP_DIP;
  const fits = below + START_PILL_HEIGHT_DIP <= area.y + area.height;
  return {
    centerX: frame.x + frame.width / 2,
    top: fits ? below : frame.y + frame.height - START_PILL_HEIGHT_DIP - START_PILL_GAP_DIP,
  };
}

/**
 * Where main will draw the visible camera bubble of `size` in `frame` (the same rule as
 * `bubbleBoundsInArea`): bottom-left, shrunk to what the box holds, or null when not even
 * the minimum size fits.
 */
export function cameraPreviewPlacement(
  frame: CaptureRect,
  size: number = DEFAULT_CAMERA_BUBBLE.size,
): CaptureRect | null {
  const window = cameraBubbleWindowInArea(frame, size);
  if (!window) return null;
  const pad = CAMERA_BUBBLE_WINDOW_PAD;
  return {
    x: window.x + pad,
    y: window.y + pad,
    width: window.width - 2 * pad,
    height: window.height - 2 * pad,
  };
}

/**
 * The slice of the preload bridge the toggles use; tests pass a fake. Camera access and the
 * bubble settings are optional so a fake without them reads "unknown" and the defaults.
 */
export type RecordingTogglesApi = Pick<
  KaipuElectronAPI,
  "getRecordingSettings" | "updateRecordingSettings" | "onRecordingSettingsChanged"
> &
  Partial<Pick<KaipuElectronAPI, "getCameraAccessStatus" | "getSettings">>;

type ToggleKey = "isMicrophoneEnabled" | "isSystemAudioEnabled" | "isCameraEnabled";

export interface OverlayToggles {
  microphone: boolean;
  systemAudio: boolean;
  camera: boolean;
  /**
   * Camera access is denied in the OS (`getCameraAccessStatus`, the same tri-state the
   * Record page and the tray read): the Camera toggle cannot turn on, only off.
   */
  cameraBlocked: boolean;
  /** The bubble's size and shape (`AppSettings.cameraBubble`), for the placeholder. */
  cameraBubble: { size: number; shape: CameraBubbleShape };
  toggle(key: ToggleKey): void;
}

/**
 * Mic, System audio and Camera as main holds them (the shared `RecordingSettings`): read on
 * mount, kept live by the broadcast, written optimistically. The same values the Record
 * page and the tray show, so a toggle here is a toggle everywhere.
 */
export function useOverlayToggles(api: RecordingTogglesApi, enabled = true): OverlayToggles {
  const [settings, setSettings] = useState<Pick<RecordingSettings, ToggleKey>>({
    isMicrophoneEnabled: false,
    isSystemAudioEnabled: false,
    isCameraEnabled: false,
  });
  // The same camera-access read as the Record page and the tray tile.
  const access = useCameraAccess(api, enabled);
  const [bubble, setBubble] = useState<{ size: number; shape: CameraBubbleShape }>({
    size: DEFAULT_CAMERA_BUBBLE.size,
    shape: DEFAULT_CAMERA_BUBBLE.shape,
  });
  useEffect(() => {
    // A screenshot overlay has no inputs to show: it never reads recording settings.
    if (!enabled) return;
    let live = true;
    api
      .getRecordingSettings()
      .then((current) => {
        if (live) setSettings(current);
      })
      .catch(() => {});
    api
      .getSettings?.()
      .then((app) => {
        if (live && app.cameraBubble) {
          setBubble({ size: app.cameraBubble.size, shape: app.cameraBubble.shape });
        }
      })
      .catch(() => {});
    const unsubscribe = api.onRecordingSettingsChanged((current) => setSettings(current));
    return () => {
      live = false;
      unsubscribe();
    };
  }, [api, enabled]);
  const cameraBlocked = access === "blocked";
  const blockedRef = useRef(cameraBlocked);
  blockedRef.current = cameraBlocked;
  // Read through a ref so the write happens once per click, outside a state updater.
  const latest = useRef(settings);
  latest.current = settings;
  const toggle = useCallback(
    (key: ToggleKey) => {
      const next = !latest.current[key];
      // A blocked camera cannot be turned on from here either; one that is on can go off.
      if (key === "isCameraEnabled" && next && blockedRef.current) return;
      latest.current = { ...latest.current, [key]: next };
      setSettings(latest.current);
      api.updateRecordingSettings({ [key]: next });
    },
    [api],
  );
  return useMemo(
    () => ({
      microphone: settings.isMicrophoneEnabled,
      systemAudio: settings.isSystemAudioEnabled,
      camera: settings.isCameraEnabled,
      cameraBlocked,
      cameraBubble: bubble,
      toggle,
    }),
    [settings, cameraBlocked, bubble, toggle],
  );
}

/** Every mode's label, as the widget prints it. */
function useModeLabels(): Record<CaptureMode, string> {
  const t = useTranslations("screenshots");
  return { frame: t("modeFrame"), window: t("modeWindow"), screen: t("modeScreen") };
}

const TOGGLES = [
  {
    key: "isMicrophoneEnabled",
    icon: Mic,
    label: "overlay.toggleMicrophone",
    state: "microphone",
  },
  {
    key: "isSystemAudioEnabled",
    icon: Volume2,
    label: "overlay.toggleSystemAudio",
    state: "systemAudio",
  },
  { key: "isCameraEnabled", icon: Camera, label: "overlay.toggleCamera", state: "camera" },
] as const satisfies readonly {
  key: ToggleKey;
  icon: LucideIcon;
  label: string;
  state: "microphone" | "systemAudio" | "camera";
}[];

/**
 * The vertical widget attached to the selection: one 38 DIP button per enabled mode (keys
 * 1..n; the active one solid pink with its name floating beside it), the three input
 * toggles (pink when on, struck through when off), and Cancel (Esc).
 */
export function RecordWidget({
  chrome,
  toggles,
  left,
  top,
  side,
}: {
  chrome: OverlayChrome;
  toggles: OverlayToggles;
  left: number;
  top: number;
  side: "right" | "left" | "inside";
}): React.JSX.Element {
  const t = useTranslations("screenshots");
  const tCamera = useTranslations("cameraSettings");
  const labels = useModeLabels();
  return (
    <div
      role="toolbar"
      aria-orientation="vertical"
      aria-label={t("overlay.recordWidget")}
      data-testid="record-widget"
      data-side={side}
      className={styles.recordWidget}
      style={{ left, top }}
      {...keepPointer}
    >
      {chrome.onIntent && (
        <>
          <IntentSwitch chrome={chrome} vertical />
          <span className={styles.widgetDivider} aria-hidden />
        </>
      )}
      <div role="group" aria-label={t("overlay.modes")} className={styles.widgetGroup}>
        {chrome.modes.map((mode, index) => {
          const Icon = MODE_ICON[mode];
          const active = mode === chrome.mode;
          return (
            <button
              key={mode}
              type="button"
              className={styles.widgetMode}
              aria-pressed={active}
              aria-label={t("overlay.modeKey", { mode: labels[mode], key: index + 1 })}
              title={t("overlay.modeKey", { mode: labels[mode], key: index + 1 })}
              onClick={() => chrome.onMode(mode)}
            >
              <Icon size={16} aria-hidden />
              {active ? (
                <span className={styles.widgetModeLabel} data-side={side} aria-hidden>
                  {labels[mode]}
                </span>
              ) : (
                <span className={styles.widgetDigit} aria-hidden>
                  {index + 1}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <span className={styles.widgetDivider} aria-hidden />
      <div role="group" aria-label={t("overlay.inputs")} className={styles.widgetGroup}>
        {TOGGLES.map(({ key, icon, label, state }) => {
          const on = toggles[state];
          // Same rule and words as the Record page's split tile: blocked reads off and
          // cannot turn on; the title says why and where to allow it.
          const blocked = state === "camera" && toggles.cameraBlocked;
          const cannotToggle = blocked && !on;
          const Icon = blocked ? Lock : icon;
          const text = blocked ? tCamera("blockedTile") : t(label);
          return (
            <button
              key={key}
              type="button"
              className={styles.widgetToggle}
              aria-pressed={on}
              aria-disabled={cannotToggle || undefined}
              aria-label={text}
              data-blocked={blocked || undefined}
              title={
                blocked
                  ? `${text} · ${tCamera("blockedBody")}`
                  : `${text} · ${on ? t("overlay.on") : t("overlay.off")}`
              }
              onClick={cannotToggle ? undefined : () => toggles.toggle(key)}
            >
              <Icon size={15} aria-hidden />
              {!on && !blocked && <span className={styles.widgetStrike} aria-hidden />}
            </button>
          );
        })}
      </div>
      <span className={styles.widgetDivider} aria-hidden />
      <button
        type="button"
        className={styles.widgetCancel}
        aria-label={t("overlay.cancel")}
        title={t("overlay.cancelTitle")}
        onClick={chrome.onCancel}
      >
        <X size={14} aria-hidden />
      </button>
    </div>
  );
}

/** Free · 16:9 · 9:16 · 1:1, a divider, and the live size in device pixels. */
export function RatioBar({
  ratio,
  onRatio,
  size,
  left,
  top,
}: {
  ratio: RecordingRatio;
  onRatio(ratio: RecordingRatio): void;
  size: { width: number; height: number };
  left: number;
  top: number;
}): React.JSX.Element {
  const t = useTranslations("screenshots");
  return (
    <div
      role="group"
      aria-label={t("overlay.ratios")}
      data-testid="ratio-bar"
      className={styles.ratioBar}
      style={{ left, top }}
      {...keepPointer}
    >
      {RECORDING_RATIOS.map((value) => (
        <button
          key={value}
          type="button"
          className={styles.ratioChip}
          aria-pressed={value === ratio}
          onClick={() => onRatio(value)}
        >
          {value === "free" ? t("overlay.ratioFree") : value}
        </button>
      ))}
      <span className={styles.ratioDivider} aria-hidden />
      <span className={styles.ratioSize} data-testid="ratio-size">
        {size.width} × {size.height}
      </span>
    </div>
  );
}

/** The pink "● Start recording ↵" (or "Record this window") pill under the selection. */
export function StartPill({
  label,
  onStart,
  disabled = false,
  centerX,
  top,
}: {
  label: string;
  onStart(): void;
  disabled?: boolean;
  centerX: number;
  top: number;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={styles.startPill}
      data-testid="start-pill"
      style={{ left: centerX, top }}
      disabled={disabled}
      {...keepPointer}
      onClick={(event) => {
        // A click on the pill must not reach the sheet (which would draw or answer).
        event.stopPropagation();
        onStart();
      }}
    >
      <span className={styles.startDot} aria-hidden />
      {label}
      <kbd className={styles.kbd} aria-hidden>
        ↵
      </kbd>
    </button>
  );
}

/** Where the camera bubble will be recorded, drawn while the camera is on. */
export function CameraPreview({
  rect,
  shape = DEFAULT_CAMERA_BUBBLE.shape,
}: {
  rect: CaptureRect;
  shape?: CameraBubbleShape;
}): React.JSX.Element {
  return (
    <div
      className={styles.cameraPreview}
      data-testid="camera-preview"
      data-shape={shape}
      aria-hidden
      style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
    >
      <Camera size={28} aria-hidden />
    </div>
  );
}
