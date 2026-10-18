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

/** Payload of every channel that asks for a capture (invoke, hotkey, panel request). */
export interface CaptureRequestPayload {
  mode: CaptureMode;
}

/** What main did with a capture: opened the editor path, or finished it without one. */
export type AfterCaptureKind = "editor" | "quiet";

/**
 * `after: "editor"` carries the bytes the editor will open. `after: "quiet"` means main
 * already saved and/or copied: `png` is empty (the bytes never cross IPC when no editor
 * opens), `saved` is the vault item written, `copied` says whether the clipboard got it.
 */
export type CaptureResult =
  | {
      kind: "captured";
      after: AfterCaptureKind;
      png: ArrayBuffer;
      width: number;
      height: number;
      mode: CaptureMode;
      saved: { id: string } | null;
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

/** A DIP size. */
export interface CaptureSize {
  width: number;
  height: number;
}

/**
 * What the user pressed on the overlay's action bar. `"record"` is reserved: it joins
 * this union when the recording picker reuses the overlay.
 */
export type CaptureAction = "capture" | "copy";

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
  | { kind: "rect"; mode: "frame"; action: CaptureAction; displayId: number; rect: CaptureRect }
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
 * until the lister answers, `[]` when it found none.
 */
export interface OverlayState {
  mode: CaptureMode;
  hoverDisplayId: number | null;
  frameDisplayId: number | null;
  windows: ListedWindow[] | null;
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
