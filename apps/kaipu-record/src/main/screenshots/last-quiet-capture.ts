import type { CaptureMode } from "@shared/types/screenshot-capture";

/** A copy-only capture whose bytes main keeps for the toast's Annotate button. */
export interface QuietCapture {
  png: Buffer;
  width: number;
  height: number;
  mode: CaptureMode;
}

let last: QuietCapture | null = null;

/** Replaces whatever was kept: only the latest quiet capture is ever annotatable. */
export function keepLastQuietCapture(capture: QuietCapture): void {
  last = capture;
}

/** Frees the kept bytes (a new capture starts). */
export function clearLastQuietCapture(): void {
  last = null;
}

/**
 * Hands the kept bytes to one consumer (Annotate) and frees them. The toast's auto-hide
 * never calls this: the bytes outlive it until the next capture or a consumer takes them.
 */
export function takeLastQuietCapture(): QuietCapture | null {
  const taken = last;
  last = null;
  return taken;
}
