/**
 * Screenshot capture contract shared by main, preload and renderer.
 *
 * Preload-reachable: literals and types only, never a value import from a
 * workspace package.
 */

export const CAPTURE_MODES = ["area", "screen", "frame"] as const;
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
 * What the user picked on a capture overlay (renderer → main). `rect` is display-relative
 * DIP, which is the overlay window's own coordinate space: the window covers the display.
 */
export type OverlayAnswer =
  | { kind: "rect"; displayId: number; rect: CaptureRect }
  | { kind: "display"; displayId: number }
  | { kind: "cancelled" };

/** Main → every overlay: the display the pointer is over, so only that one highlights. */
export interface OverlayState {
  hoverDisplayId: number | null;
}
