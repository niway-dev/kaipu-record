import type { SourceThumbnail } from "../use-source-thumbnails";

export function timeToFraction(t: number, duration: number): number {
  if (duration <= 0) return 0;
  return Math.max(0, Math.min(1, t / duration));
}

export function fractionToTime(f: number, duration: number): number {
  return Math.max(0, Math.min(1, f)) * duration;
}

function formatTick(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

const TICK_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300] as const;

export function rulerTicks(duration: number): { time: number; label: string }[] {
  const step = TICK_STEPS.find((s) => duration / s <= 10) ?? 600;
  const ticks: { time: number; label: string }[] = [];
  for (let t = 0; t <= duration; t += step) {
    ticks.push({ time: t, label: formatTick(t) });
  }
  return ticks;
}

function tileTargets(sourceStart: number, sourceEnd: number, count: number): number[] {
  return Array.from(
    { length: Math.max(0, count) },
    (_, i) => sourceStart + ((i + 0.5) / count) * (sourceEnd - sourceStart),
  );
}

function nearestThumbnail(thumbnails: SourceThumbnail[], target: number): SourceThumbnail {
  let nearest = thumbnails[0];
  for (const thumb of thumbnails) {
    if (Math.abs(thumb.sourceTime - target) < Math.abs(nearest.sourceTime - target)) {
      nearest = thumb;
    }
  }
  return nearest;
}

export function thumbnailsForRange(
  thumbnails: SourceThumbnail[],
  sourceStart: number,
  sourceEnd: number,
  count: number,
): SourceThumbnail[] {
  if (thumbnails.length === 0) return [];
  return tileTargets(sourceStart, sourceEnd, count).map((t) => nearestThumbnail(thumbnails, t));
}

/**
 * {@link thumbnailsForRange} for a file that does not cover the whole source (the webcam
 * starts late or ends early): a tile whose nearest frame is more than `maxGap` seconds away
 * is null — there is no footage there, so it must not borrow the first or last frame.
 */
export function thumbnailsForRangeWithin(
  thumbnails: SourceThumbnail[],
  sourceStart: number,
  sourceEnd: number,
  count: number,
  maxGap: number,
): (SourceThumbnail | null)[] {
  if (thumbnails.length === 0) return [];
  return tileTargets(sourceStart, sourceEnd, count).map((t) => {
    const nearest = nearestThumbnail(thumbnails, t);
    return Math.abs(nearest.sourceTime - t) <= maxGap ? nearest : null;
  });
}
