import type { CoveredRange, SourceThumbnail } from "../use-source-thumbnails";

export function timeToFraction(t: number, duration: number): number {
  if (duration <= 0) return 0;
  return Math.max(0, Math.min(1, t / duration));
}

export function fractionToTime(f: number, duration: number): number {
  return Math.max(0, Math.min(1, f)) * duration;
}

function formatTick(seconds: number, step: number): string {
  // A step under a second would label neighbours "0:01" and "0:01": show the tenth.
  if (step < 1) return formatScrubTime(seconds);
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Labelled step (seconds) → how many parts the minor ticks cut it into. Each minor step
 *  is a round number of seconds or quarter seconds, so the ruler reads like a real one. */
const TICK_STEPS = [
  [1, 4],
  [2, 4],
  [5, 5],
  [10, 5],
  [15, 3],
  [30, 6],
  [60, 4],
  [120, 4],
  [300, 5],
  [600, 5],
] as const;

/** Only a zoomed ruler goes below a second, so the ruler at fit never changes. */
const FINE_TICK_STEPS = [
  [0.1, 5],
  [0.2, 4],
  [0.5, 5],
] as const;

type TickStep = readonly [number, number];

/** The step that keeps about ten labels in the VISIBLE lane: the whole timeline is `zoom`
 *  lanes wide, so it may carry `10 * zoom` labels. At zoom 1 this is the fit ruler. */
function rulerStep(duration: number, zoom: number): TickStep {
  const steps: readonly TickStep[] = zoom > 1 ? [...FINE_TICK_STEPS, ...TICK_STEPS] : TICK_STEPS;
  return (
    steps.find(([s]) => duration / s <= 10 * Math.max(1, zoom)) ?? TICK_STEPS[TICK_STEPS.length - 1]
  );
}

/** Seconds on a 1 ms grid: `i * 0.1` accumulates no error this way, so keys and `===` hold. */
function exact(seconds: number): number {
  return Math.round(seconds * 1000) / 1000;
}

/** First and last index of a step grid that falls in the window (one step of overscan). */
function indexSpan(
  step: number,
  duration: number,
  window: TimeWindow | undefined,
): { first: number; last: number } {
  const lastAll = Math.floor(duration / step + 1e-9);
  if (!window) return { first: 0, last: lastAll };
  return {
    first: Math.max(0, Math.floor(window.start / step) - 1),
    last: Math.min(lastAll, Math.ceil(window.end / step) + 1),
  };
}

export interface TimeWindow {
  start: number;
  end: number;
}

/**
 * The labelled ticks. `zoom` picks the step (about ten labels per visible lane) and
 * `window`, the visible range, keeps a deep zoom on a long take from building thousands
 * of ticks nobody can see: only the window plus one step each side is returned.
 */
export function rulerTicks(
  duration: number,
  zoom = 1,
  window?: TimeWindow,
): { time: number; label: string }[] {
  const [step] = rulerStep(duration, zoom);
  const { first, last } = indexSpan(step, duration, window);
  const ticks: { time: number; label: string }[] = [];
  for (let i = first; i <= last; i++) {
    const time = exact(i * step);
    ticks.push({ time, label: formatTick(time, step) });
  }
  return ticks;
}

/** The unlabelled ticks between the labelled ones. Built from an integer index, not by
 *  adding the step repeatedly, so 0.25 s steps do not drift off the labelled ticks. */
export function rulerMinorTicks(duration: number, zoom = 1, window?: TimeWindow): number[] {
  const [step, parts] = rulerStep(duration, zoom);
  const minor = step / parts;
  const { first, last } = indexSpan(minor, duration, window);
  const times: number[] = [];
  for (let i = Math.max(1, first); i <= last; i++) {
    if (i % parts !== 0) times.push(exact(i * minor));
  }
  return times;
}

/** The time under the pointer while hovering the ruler, to a tenth of a second ("0:07.4"). */
export function formatScrubTime(seconds: number): string {
  const tenths = Math.floor(Math.max(0, seconds) * 10);
  const m = Math.floor(tenths / 600);
  const s = Math.floor((tenths % 600) / 10);
  return `${m}:${String(s).padStart(2, "0")}.${tenths % 10}`;
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

/**
 * The frame nearest to a SOURCE time, or null when none have been decoded yet. With
 * `covered` (a companion file that does not span the whole source: the webcam starts late
 * or ends early) a time outside `[start, end)` is null too — there is no footage there, so
 * the tile must stay empty instead of borrowing the first or last frame.
 */
export function thumbnailAt(
  thumbnails: SourceThumbnail[],
  sourceTime: number,
  covered?: CoveredRange,
): SourceThumbnail | null {
  if (thumbnails.length === 0) return null;
  if (covered && !(sourceTime >= covered.start && sourceTime < covered.end)) return null;
  return nearestThumbnail(thumbnails, sourceTime);
}

/** One thumbnail slot of a block: `left` and `width` are fractions of the BLOCK's width. */
export interface ThumbnailTile {
  index: number;
  left: number;
  width: number;
  /** SOURCE time at the tile's centre: look the frame up with {@link thumbnailAt}. */
  sourceTime: number;
}

/** One tile roughly every this many pixels of block width. */
export const THUMB_TILE_PX = 72;

/**
 * The tiles of one timeline block that intersect the visible window (plus one tile each
 * side), so a block 12 000 px wide at 16x draws a dozen images, not hundreds, and still
 * leaves no blank stretch in view. The tile count follows the block's width in pixels
 * (`scale` is pixels per timeline second), so zooming in asks for more, narrower tiles.
 * The frame behind each tile is the nearest decoded one: stretched, never missing.
 */
export function thumbnailTiles(input: {
  timelineStart: number;
  timelineEnd: number;
  sourceStart: number;
  sourceEnd: number;
  /** Pixels per timeline second; 0 while the lane is unmeasured (one tile for the block). */
  scale: number;
  visible: TimeWindow;
  tilePx?: number;
}): { count: number; tiles: ThumbnailTile[] } {
  const { timelineStart, timelineEnd, sourceStart, sourceEnd, scale, visible } = input;
  const length = timelineEnd - timelineStart;
  const widthPx = length * scale;
  const count =
    widthPx > 0 ? Math.max(1, Math.round(widthPx / (input.tilePx ?? THUMB_TILE_PX))) : 1;
  const place = (index: number): ThumbnailTile => ({
    index,
    left: index / count,
    width: 1 / count,
    sourceTime: sourceStart + ((index + 0.5) / count) * (sourceEnd - sourceStart),
  });
  if (length <= 0) return { count, tiles: [place(0)] };
  if (visible.end <= timelineStart || visible.start >= timelineEnd) return { count, tiles: [] };
  const seconds = length / count;
  const first = Math.max(0, Math.floor((visible.start - timelineStart) / seconds) - 1);
  const last = Math.min(count - 1, Math.ceil((visible.end - timelineStart) / seconds));
  const tiles: ThumbnailTile[] = [];
  for (let i = first; i <= last; i++) tiles.push(place(i));
  return { count, tiles };
}
