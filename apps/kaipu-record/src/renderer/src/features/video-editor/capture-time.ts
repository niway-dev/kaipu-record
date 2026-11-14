import type { SceneSource } from "./scene";
import { recordingAt, type SourceAxis } from "./source-axis";

/** "0:09.0": minutes, seconds and tenths, so a 5 s skip or a captured frame is visible. */
export function formatClock(seconds: number): string {
  const tenths = Math.max(0, Math.floor(seconds * 10 + 1e-6));
  const m = Math.floor(tenths / 600);
  const s = Math.floor((tenths % 600) / 10);
  return `${m}:${String(s).padStart(2, "0")}.${tenths % 10}`;
}

/**
 * The time in a frame capture's title ("1m23s"). No colon or dot: the title becomes the
 * file name (ADR 0035) and `:` is forbidden on Windows and macOS.
 */
export function captureTitleTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds + 1e-6));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const two = (n: number): string => String(n).padStart(2, "0");
  if (h > 0) return `${h}h${two(m)}m${two(s)}s`;
  if (m > 0) return `${m}m${two(s)}s`;
  return `${s}s`;
}

/**
 * The existing capture taken at `sourceSeconds`, compared at millisecond precision (the
 * resolution a stored link keeps), or undefined. A slide frame has no source second
 * (`null`), so it never matches: two slide captures are not the same frame.
 */
export function findCaptureAt<T extends { sourceTimeSeconds: number | null }>(
  captures: readonly T[],
  sourceSeconds: number | null,
): T | undefined {
  if (sourceSeconds === null) return undefined;
  const ms = Math.round(sourceSeconds * 1000);
  return captures.find(
    (capture) =>
      capture.sourceTimeSeconds !== null && Math.round(capture.sourceTimeSeconds * 1000) === ms,
  );
}

/** The recording a frame came from, and where inside it (ADR 0058). */
export interface CaptureOrigin {
  /** The `SceneSource.id`; null = the opened recording. */
  sourceId: string | null;
  /** The library asset the saved link points at. */
  assetId: string;
  /** Seconds inside THAT recording's own file, never axis seconds. */
  localSeconds: number;
}

/**
 * Which recording holds the axis second a frame was taken at, and the local second inside it.
 * Null for a slide (`axisSeconds` null) or a second no recording holds.
 */
export function captureOriginAt(
  axis: SourceAxis,
  sources: readonly SceneSource[] | undefined,
  primaryAssetId: string,
  axisSeconds: number | null,
): CaptureOrigin | null {
  if (axisSeconds === null) return null;
  const hit = recordingAt(axis, axisSeconds);
  if (!hit) return null;
  if (hit.recording.sourceId === null) {
    return { sourceId: null, assetId: primaryAssetId, localSeconds: hit.localTime };
  }
  const joined = sources?.find((s) => s.id === hit.recording.sourceId);
  if (!joined) return null;
  return { sourceId: joined.id, assetId: joined.assetId, localSeconds: hit.localTime };
}

/**
 * The axis second of a capture's link (`assetId`, `seconds` in that recording's own file): the
 * inverse of `captureOriginAt`. The opened recording wins when the same asset is also joined;
 * an asset the scene does not hold has no place on its axis (null).
 */
export function axisSecondsOfCapture(
  sources: readonly SceneSource[] | undefined,
  primaryAssetId: string,
  assetId: string,
  seconds: number,
): number | null {
  if (assetId === primaryAssetId) return seconds;
  const joined = sources?.find((s) => s.assetId === assetId);
  return joined ? joined.offset + seconds : null;
}
