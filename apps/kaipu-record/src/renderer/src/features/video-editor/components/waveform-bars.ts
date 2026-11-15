/**
 * Where the Audio lane's waveform bars go (NIW2-775): pure geometry, no DOM.
 *
 * Bars sit on a fixed pixel pitch anchored to the CONTENT (`x = k * pitch`), not to the
 * window, so a bar keeps the same buckets while the timeline scrolls and nothing shimmers.
 * Each bar asks "which source time is under me?" through the cut layout, so cuts and zoom
 * move the waveform like they move the other lanes.
 */
import { PEAK_BUCKETS_PER_SECOND } from "../audio-peaks";
import type { MutedRange } from "../audio-edits";
import type { LayoutEntry } from "../timeline";

export interface WaveformBarsInput {
  /** Peak buckets, {@link PEAK_BUCKETS_PER_SECOND} per source second. */
  peaks: Float32Array;
  /** Buckets below this index are decoded; the rest are not yet. */
  filled: number;
  layout: LayoutEntry[];
  /** Pixels per timeline second. */
  scale: number;
  /** Pixels scrolled from the start of the content. */
  scroll: number;
  /** Width of the visible window in px. */
  laneWidth: number;
  /** Distance between two bars' left edges, in px. */
  pitch: number;
  mutedRanges: MutedRange[];
  audioMuted: boolean;
}

export interface WaveformBar {
  /** Left edge in px, within the visible window (slightly negative at the left edge). */
  x: number;
  /** The largest absolute sample in the bar's source span, 0..1. */
  peak: number;
  /** Drawn dimmed: inside a muted range, or the whole recording is muted. */
  muted: boolean;
}

/** The first entry whose end is after `time` (entries are in timeline order). */
function firstEntryEndingAfter(layout: LayoutEntry[], time: number): number {
  let lo = 0;
  let hi = layout.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (layout[mid]!.timelineEnd > time) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

export function waveformBars(input: WaveformBarsInput): WaveformBar[] {
  const { peaks, layout, scale, scroll, laneWidth, pitch, mutedRanges, audioMuted } = input;
  const decoded = Math.min(input.filled, peaks.length);
  if (!(scale > 0) || !(laneWidth > 0) || !(pitch > 0) || decoded <= 0 || layout.length === 0) {
    return [];
  }

  const bars: WaveformBar[] = [];
  const firstBar = Math.floor(scroll / pitch);
  for (let k = firstBar; k * pitch < scroll + laneWidth; k++) {
    const x0 = k * pitch;
    const t0 = x0 / scale;
    const t1 = (x0 + pitch) / scale;
    let peak = 0;
    let seen = false;
    let midSource: number | null = null;

    for (let i = firstEntryEndingAfter(layout, t0); i < layout.length; i++) {
      const entry = layout[i]!;
      if (entry.timelineStart >= t1) break;
      if (entry.kind !== "clip") continue;
      const a = Math.max(t0, entry.timelineStart);
      const b = Math.min(t1, entry.timelineEnd);
      if (b <= a) continue;
      if (midSource === null) {
        const mid = Math.min(entry.timelineEnd, Math.max(entry.timelineStart, (t0 + t1) / 2));
        midSource = entry.sourceStart + (mid - entry.timelineStart);
      }
      const sa = entry.sourceStart + (a - entry.timelineStart);
      const sb = entry.sourceStart + (b - entry.timelineStart);
      const lo = Math.max(0, Math.floor(sa * PEAK_BUCKETS_PER_SECOND));
      const hi = Math.min(decoded - 1, Math.max(lo, Math.ceil(sb * PEAK_BUCKETS_PER_SECOND) - 1));
      for (let bucket = lo; bucket <= hi; bucket++) {
        seen = true;
        const value = peaks[bucket]!;
        if (value > peak) peak = value;
      }
    }

    if (midSource === null || !seen) continue;
    const at = midSource;
    const muted =
      audioMuted || mutedRanges.some((range) => at >= range.sourceStart && at < range.sourceEnd);
    bars.push({ x: x0 - scroll, peak, muted });
  }
  return bars;
}
