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
