/**
 * Folds the raw main-clock samples collected during a recording into the persisted
 * `CursorTrack` (video-time ms). Pure — the tracker calls it once, at finalize.
 */
import type { CursorButton, CursorClick, CursorTrack } from "@shared/cursor-track";
import { type ClockAnchor, toVideoTimeMs } from "./cursor-clock";

export interface RawCursorData {
  /** Parallel arrays, main clock ms (already de-duplicated by CursorSampleBuffer). */
  t: number[];
  x: number[];
  y: number[];
  /** Main clock ms; position already normalized to the captured display. */
  clicks: { t: number; x: number; y: number; button: CursorButton }[];
}

export interface BuildCursorTrackInput {
  raw: RawCursorData;
  anchor: ClockAnchor;
  anchorQuality: "exact" | "estimated";
  clicksAvailable: boolean;
  display: CursorTrack["display"];
  /**
   * Video time of the last frame in the file (`meta.durationSeconds * 1000`), when the
   * caller knows it. The tracker keeps sampling until `recordingFinalize`, which only
   * runs after `output.finalize()` and the recorder's MIN_SAVING_MS dwell — without
   * this cut the track carries 0.6–2 s of samples and clicks past the end of the media
   * (the user moving the pointer to the "Saving…" bar, or clicking Stop again).
   */
  maxMs?: number;
  /** `CursorSampleBuffer.truncatedAtMs` — main clock, null when the cap was never hit. */
  truncatedAtMainMs?: number | null;
}

export function buildCursorTrack(input: BuildCursorTrackInput): CursorTrack {
  const { maxMs } = input;
  const beyondEnd = (ms: number): boolean => maxMs !== undefined && ms > maxMs;
  const t: number[] = [];
  const x: number[] = [];
  const y: number[] = [];
  for (let i = 0; i < input.raw.t.length; i++) {
    const v = toVideoTimeMs(input.raw.t[i], input.anchor);
    if (v === null) continue;
    const ms = Math.round(v);
    if (beyondEnd(ms)) continue;
    // Rounding can make two samples share a millisecond; keep the later one only.
    if (t.length > 0 && t[t.length - 1] === ms) {
      x[x.length - 1] = input.raw.x[i];
      y[y.length - 1] = input.raw.y[i];
      continue;
    }
    t.push(ms);
    x.push(input.raw.x[i]);
    y.push(input.raw.y[i]);
  }

  const clicks: CursorClick[] = [];
  for (const c of input.raw.clicks) {
    const v = toVideoTimeMs(c.t, input.anchor);
    if (v === null) continue;
    const ms = Math.round(v);
    if (beyondEnd(ms)) continue;
    clicks.push({ t: ms, x: c.x, y: c.y, button: c.button });
  }
  clicks.sort((a, b) => a.t - b.t);

  const track: CursorTrack = {
    version: 1,
    display: input.display,
    anchor: input.anchorQuality,
    clicksAvailable: input.clicksAvailable,
    t,
    x,
    y,
    clicks,
  };
  if (input.truncatedAtMainMs != null) {
    const v = toVideoTimeMs(input.truncatedAtMainMs, input.anchor);
    // A cap hit inside a pause, or after the last frame, is not worth reporting.
    if (v !== null && !beyondEnd(Math.round(v))) track.truncatedAtMs = Math.round(v);
  }
  return track;
}
