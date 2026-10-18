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

export type CaptureResult =
  | { kind: "captured"; png: ArrayBuffer; width: number; height: number; mode: CaptureMode }
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
  /** Display-relative DIP, clamped to that display. */
  rect: CaptureRect;
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
      rect: CaptureRect;
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
