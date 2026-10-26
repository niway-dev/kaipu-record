/**
 * Screenshot capture contract shared by main, preload and renderer.
 *
 * Preload-reachable: literals and types only, never a value import from a
 * workspace package.
 */

export const CAPTURE_MODES = ["frame", "window", "screen"] as const; // pill order = keys 1-3
export type CaptureMode = (typeof CAPTURE_MODES)[number];

export function isCaptureMode(value: unknown): value is CaptureMode {
  return (CAPTURE_MODES as readonly unknown[]).includes(value);
}

/**
 * Owner decision 2026-10-18: Window mode is buggy and stays off until fixed; flip to true
 * to re-enable. The contract below (`CAPTURE_MODES`, the `window` answer, `ListedWindow`)
 * is unchanged: only what the user can reach derives from `ENABLED_CAPTURE_MODES`.
 */
export const WINDOW_MODE_ENABLED = false as const;

/** The modes a user can reach, in pill order (keys 1..n). */
export const ENABLED_CAPTURE_MODES: readonly CaptureMode[] = CAPTURE_MODES.filter(
  (mode) => mode !== "window" || WINDOW_MODE_ENABLED,
);

/** True for a mode that exists and is currently reachable. */
export function isEnabledCaptureMode(
  value: unknown,
  enabledModes: readonly CaptureMode[] = ENABLED_CAPTURE_MODES,
): value is CaptureMode {
  return isCaptureMode(value) && enabledModes.includes(value);
}

/** A stored or requested mode that may be disabled now, mapped to Frame when it is. */
export function toEnabledCaptureMode(
  value: unknown,
  enabledModes: readonly CaptureMode[] = ENABLED_CAPTURE_MODES,
): CaptureMode {
  return isEnabledCaptureMode(value, enabledModes) ? value : "frame";
}

/**
 * Why the overlay opened: to take a screenshot (`capture`, every entry point until now) or
 * to choose what to record (`record`: the `recordArea` shortcut). The intent only changes
 * which action Enter fires and which frame memory the overlay uses; both bars offer both.
 */
export const CAPTURE_INTENTS = ["capture", "record"] as const;
export type CaptureIntent = (typeof CAPTURE_INTENTS)[number];

export function isCaptureIntent(value: unknown): value is CaptureIntent {
  return (CAPTURE_INTENTS as readonly unknown[]).includes(value);
}

/** Payload of every channel that asks for a capture (invoke, hotkey, panel request). */
export interface CaptureRequestPayload {
  mode: CaptureMode;
  /** Absent means `capture`. */
  intent?: CaptureIntent;
}

/** What main did with a capture: opened the editor path, or finished it without one. */
export type AfterCaptureKind = "editor" | "quiet";

/** A screenshot main wrote to the vault: its vault id and the asset id routes use. */
export interface SavedScreenshotRef {
  id: string;
  assetId: string;
}

/**
 * Main saves every capture before answering. `saved` is the vault item written and
 * `copied` says whether the clipboard got it; `png` is then empty (the bytes never cross
 * IPC), and `after` says whether the renderer opens the editor on `saved` or nothing.
 * Only a save that failed carries the bytes: `after: "editor"` with `saved: null` opens
 * them in memory, so the shot is never lost.
 */
export type CaptureResult =
  | {
      kind: "captured";
      after: AfterCaptureKind;
      png: ArrayBuffer;
      width: number;
      height: number;
      mode: CaptureMode;
      saved: SavedScreenshotRef | null;
      copied: boolean;
    }
  | { kind: "cancelled" }
  | { kind: "unsupported"; mode: CaptureMode; platform: NodeJS.Platform };

/** A DIP rectangle; structurally the same as Electron's `Rectangle`. */
export interface CaptureRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Aspect ratios the Frame box offers when the overlay opens to record (design "Kaipu
 * Record Modes"): `free` draws any rectangle, the others lock width over height.
 */
export const RECORDING_RATIOS = ["free", "16:9", "9:16", "1:1"] as const;
export type RecordingRatio = (typeof RECORDING_RATIOS)[number];

export function isRecordingRatio(value: unknown): value is RecordingRatio {
  return (RECORDING_RATIOS as readonly unknown[]).includes(value);
}

/**
 * A remembered recording area for one display: the rectangle (display-relative DIP) and
 * the ratio it was drawn with. `ratio` is optional so areas remembered before ratios
 * existed still load (they read as `free`).
 */
export interface RememberedArea extends CaptureRect {
  ratio?: RecordingRatio;
}

/** A DIP size. */
export interface CaptureSize {
  width: number;
  height: number;
}

/**
 * What the user pressed on the overlay's action bar. `capture` and `copy` take a screenshot;
 * `record` starts recording the selection; `select` makes it the recording target without
 * starting (Enter in the `record` intent), so camera and audio can be set first. Main never
 * captures pixels for `record` or `select` (ADR 0030).
 */
export const CAPTURE_ACTIONS = ["capture", "copy", "record", "select"] as const;
export type CaptureAction = (typeof CAPTURE_ACTIONS)[number];

export function isCaptureAction(value: unknown): value is CaptureAction {
  return (CAPTURE_ACTIONS as readonly unknown[]).includes(value);
}

/** The two actions that choose a recording target instead of taking a screenshot. */
export function isRecordAction(action: CaptureAction): action is "record" | "select" {
  return action === "record" || action === "select";
}

/** One on-screen window as the overlay sees it (display-relative DIP). */
export interface ListedWindow {
  /** macOS CGWindowID or Windows HWND, both as decimal strings. */
  id: string;
  /** Window title, or the owner name when the title is empty. */
  title: string;
  ownerName: string;
  /** The display holding the window's centre. */
  displayId: number;
  /** Display-relative DIP, clamped to that display: what the overlay highlights. */
  rect: CaptureRect;
  /**
   * The whole window's size in DIP, before the clamp: a window spanning two displays is
   * larger than `rect`. The Windows window source is requested at this size, so the shot
   * is not downscaled into the clamped rect.
   */
  fullSize: CaptureSize;
}

/**
 * What the user picked on a capture overlay (renderer → main). `rect` is display-relative
 * DIP, which is the overlay window's own coordinate space: the window covers the display.
 * `mode` is the mode the user ended in, which may differ from the one requested: providers
 * capture by it.
 */
export type OverlayAnswer =
  | {
      kind: "rect";
      mode: "frame";
      action: CaptureAction;
      displayId: number;
      rect: CaptureRect;
      /** Record intent only: the ratio the box was locked to, stored with the take. */
      ratio?: RecordingRatio;
    }
  | { kind: "display"; mode: "screen"; action: CaptureAction; displayId: number }
  | {
      kind: "window";
      mode: "window";
      action: CaptureAction;
      displayId: number;
      windowId: string;
      /** Main replaces it with its own list's `rect`; the renderer's value is never trusted. */
      rect: CaptureRect;
      /** Filled by main from its own list (`ListedWindow.fullSize`); the renderer omits it. */
      fullSize?: CaptureSize;
    }
  | { kind: "cancelled" };

/**
 * Main → every overlay. `mode`: the mode every overlay renders right now. `hoverDisplayId`:
 * the display the pointer is over, so only that one highlights (Screen). `frameDisplayId`:
 * the one display that shows the Frame box; `null` in every other mode. `windows`: `null`
 * until the lister answers, `[]` when it found none. `cursor`: the pointer in global DIP when
 * main sent this state, present once `windows` has landed, so the Window picker can
 * highlight the window under a pointer that has not moved over it yet.
 */
export interface OverlayState {
  mode: CaptureMode;
  hoverDisplayId: number | null;
  frameDisplayId: number | null;
  windows: ListedWindow[] | null;
  cursor?: { x: number; y: number };
}

/** Main → toast window. */
export interface CaptureToastPayload {
  /** Data URL, at most 160 px wide. */
  thumbnail: string;
  width: number;
  height: number;
  mode: CaptureMode;
  /** The vault item when the shot was saved. */
  saved: { id: string } | null;
  copied: boolean;
}

/** What the toast's buttons ask main to do (toast → main, `screenshot:toast-action`). */
export const CAPTURE_TOAST_ACTIONS = ["annotate", "open-library", "save", "dismiss"] as const;
export type CaptureToastAction = (typeof CAPTURE_TOAST_ACTIONS)[number];

export function isCaptureToastAction(value: unknown): value is CaptureToastAction {
  return (CAPTURE_TOAST_ACTIONS as readonly unknown[]).includes(value);
}

/**
 * Main → main window (`screenshot:open-saved`): show a saved screenshot, then call
 * `revealAfterCapture()` so the window comes back already on it. `target: "editor"` is
 * `/editor/image/:assetId`, `"library"` is `/library/:assetId`.
 */
export interface OpenSavedScreenshotRequest {
  target: "editor" | "library";
  assetId: string;
}

/**
 * Main → main window (`screenshot:open-quiet-capture`): the bytes of a copy-only quiet
 * capture, handed over once for Annotate. The editor opens them as a `blob` source with
 * `origin: "quiet"`, so it neither saves nor copies them again.
 */
export interface QuietCaptureHandOff {
  png: ArrayBuffer;
  width: number;
  height: number;
  mode: CaptureMode;
}
