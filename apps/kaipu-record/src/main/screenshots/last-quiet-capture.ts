import type { CaptureMode } from "@shared/types/screenshot-capture";

/** A copy-only capture whose bytes main keeps for the toast's Annotate button. */
export interface QuietCapture {
  png: Buffer;
  width: number;
  height: number;
  mode: CaptureMode;
  /** The workspace the capture started in; the toast's Save writes nothing anywhere else. */
  workspaceId: string | null;
}

/** The kept bytes, and the capture they belong to (`sequence`, see `peekLastQuietCapture`). */
export interface KeptQuietCapture {
  capture: QuietCapture;
  sequence: number;
}

let last: QuietCapture | null = null;
/** Bumped every time a capture starts, so late work can tell its capture from a newer one. */
let sequence = 0;

/** Replaces whatever was kept: only the latest quiet capture is ever annotatable. */
export function keepLastQuietCapture(capture: QuietCapture): void {
  last = capture;
}

/** Frees the kept bytes because a new capture starts, and starts a new capture sequence. */
export function clearLastQuietCapture(): void {
  last = null;
  sequence += 1;
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

/** Reads the kept bytes without freeing them (the toast's Save), with their capture sequence. */
export function peekLastQuietCapture(): KeptQuietCapture | null {
  return last ? { capture: last, sequence } : null;
}

/**
 * Frees the kept bytes once they are safely elsewhere (Save wrote them to the vault), but
 * only if they still belong to capture `of`: a capture that started since keeps its own.
 */
export function releaseLastQuietCapture(of: number): void {
  if (of === sequence) last = null;
}
