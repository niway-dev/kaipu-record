/**
 * The pure logic behind a zoom-aware filmstrip (ADR 0064): where frames are kept, which
 * time slots still need one, and which stored frame a tile shows. No DOM, no decoding and
 * no mediabunny, so it runs in the renderer, in a worker and under test alike.
 *
 * Every time here is in the media file's OWN time (a frame's true timestamp), never in
 * timeline time: cuts, moves and joins therefore never invalidate a stored frame, and only
 * the media readers translate time (ADR 0058).
 */

/** A half-open stretch of a file's own time: `[start, end)`. */
export interface TimeRange {
  start: number;
  end: number;
}

/** One decoded thumbnail: where it sits in the file, what it costs, and the caller's payload. */
export interface Frame<T> {
  /** The frame's true timestamp in the file's own time, in seconds. */
  timestamp: number;
  /** Bytes this frame counts against the budget (the JPEG blob's size). */
  bytes: number;
  /** The caller's handle (a Blob, an object URL…). The store never looks inside. */
  data: T;
}

/** Thumbnail bytes held across all files (ADR 0064, decision 5). */
export const FILMSTRIP_BYTE_BUDGET = 48 * 1024 * 1024;

/** The finest slot: 0.25 s. Slot steps are this times a power of two. */
export const MIN_SLOT_STEP = 0.25;

/** At fit zoom a plan lists at most this many slots per file: what the editor decodes today. */
export const FIT_FRAME_CAP = 24;

/** A zoomed-in plan never lists more slots than this, whatever the inputs. */
export const MAX_PLAN_SLOTS = 192;

// ---------------------------------------------------------------------------------------
// Frame store
// ---------------------------------------------------------------------------------------

interface FileFrames<T> {
  /** Sorted by timestamp. Replaced, never mutated, so a returned array is a stable snapshot. */
  frames: Frame<T>[];
  /** The range the user is looking at, used to decide what to drop when this file alone is over. */
  view: TimeRange | null;
}

/** First index whose timestamp is `>= target` (the length when none is). */
function lowerBound(frames: readonly { timestamp: number }[], target: number): number {
  let lo = 0;
  let hi = frames.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (frames[mid].timestamp < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function distanceToRange(timestamp: number, range: TimeRange): number {
  if (timestamp < range.start) return range.start - timestamp;
  if (timestamp >= range.end) return timestamp - range.end;
  return 0;
}

const NO_FRAMES: readonly never[] = Object.freeze([]);

export interface FrameStoreOptions<T> {
  /** Byte budget across all files. Default: {@link FILMSTRIP_BYTE_BUDGET}. */
  budgetBytes?: number;
  /**
   * Called once for every frame the store lets go of: evicted, replaced, refused or cleared.
   * This is where an object URL gets revoked.
   */
  onEvict?: (fileKey: string, frame: Frame<T>) => void;
}

/**
 * One frame list per media file, each sorted by true timestamp, under one byte budget.
 * Over budget it drops whole files, least recently used first; when the file being filled
 * is the only one left and still over, it drops that file's frames farthest from the range
 * in view. `bytes` never exceeds the budget after a call returns.
 *
 * Recency: `add` and `frames` both count as using a file.
 */
export class FrameStore<T> {
  private readonly files = new Map<string, FileFrames<T>>(); // insertion order = recency
  private readonly budget: number;
  private readonly onEvict?: (fileKey: string, frame: Frame<T>) => void;
  private total = 0;

  constructor(options: FrameStoreOptions<T> = {}) {
    this.budget = options.budgetBytes ?? FILMSTRIP_BYTE_BUDGET;
    this.onEvict = options.onEvict;
  }

  /** Bytes of thumbnails held right now. */
  get bytes(): number {
    return this.total;
  }

  /**
   * The file's frames, sorted by timestamp. The array is a snapshot: later adds build a new
   * one, so it is safe to hold in a React external-store subscription.
   */
  frames(fileKey: string): readonly Frame<T>[] {
    const entry = this.files.get(fileKey);
    if (!entry) return NO_FRAMES;
    this.files.delete(fileKey);
    this.files.set(fileKey, entry);
    return entry.frames;
  }

  /**
   * Keeps a frame under its true timestamp. A frame at an already stored timestamp replaces
   * it. `view` is the range the user is looking at; it only matters if this file alone ends
   * up over budget. The last `view` given stays in force for the file until a later add
   * passes another; an add without one does not clear it. A frame with a non-finite timestamp or a negative or non-finite size is
   * refused (and reported through `onEvict`, so the caller releases it the usual way).
   */
  add(fileKey: string, frame: Frame<T>, view?: TimeRange): void {
    if (!Number.isFinite(frame.timestamp) || !Number.isFinite(frame.bytes) || frame.bytes < 0) {
      this.onEvict?.(fileKey, frame);
      return;
    }
    const entry = this.files.get(fileKey) ?? { frames: [], view: null };
    this.files.delete(fileKey);
    this.files.set(fileKey, entry);
    if (view) entry.view = view;

    const at = lowerBound(entry.frames, frame.timestamp);
    const existing = entry.frames[at];
    const replaced = existing && existing.timestamp === frame.timestamp ? existing : null;
    entry.frames = [
      ...entry.frames.slice(0, at),
      frame,
      ...entry.frames.slice(at + (replaced ? 1 : 0)),
    ];
    this.total += frame.bytes - (replaced?.bytes ?? 0);
    if (replaced) this.onEvict?.(fileKey, replaced);

    this.enforceBudget(fileKey, frame.timestamp);
  }

  /** Empties the store (a workspace switch): every frame is reported through `onEvict`. */
  clear(): void {
    for (const [fileKey, entry] of this.files) {
      for (const frame of entry.frames) this.onEvict?.(fileKey, frame);
    }
    this.files.clear();
    this.total = 0;
  }

  private enforceBudget(currentKey: string, justAdded: number): void {
    while (this.total > this.budget) {
      const oldest = [...this.files.keys()].find((key) => key !== currentKey);
      if (oldest === undefined) break;
      this.dropFile(oldest);
    }
    if (this.total <= this.budget) return;

    // Only the current file is left and it is still over: keep what is closest to the view.
    const entry = this.files.get(currentKey);
    if (!entry) return;
    const focus = entry.view ?? { start: justAdded, end: justAdded };
    const farthestFirst = entry.frames
      .map((frame, index) => ({ index, distance: distanceToRange(frame.timestamp, focus) }))
      .sort((a, b) => b.distance - a.distance || b.index - a.index);
    const dropped = new Set<number>();
    for (const { index } of farthestFirst) {
      if (this.total <= this.budget) break;
      dropped.add(index);
      this.total -= entry.frames[index].bytes;
    }
    const kept: Frame<T>[] = [];
    entry.frames.forEach((frame, index) => {
      if (dropped.has(index)) this.onEvict?.(currentKey, frame);
      else kept.push(frame);
    });
    if (kept.length === 0) this.files.delete(currentKey);
    else entry.frames = kept;
  }

  private dropFile(fileKey: string): void {
    const entry = this.files.get(fileKey);
    if (!entry) return;
    for (const frame of entry.frames) {
      this.total -= frame.bytes;
      this.onEvict?.(fileKey, frame);
    }
    this.files.delete(fileKey);
  }
}

// ---------------------------------------------------------------------------------------
// Slot planner
// ---------------------------------------------------------------------------------------

/** One stretch `[start, end)` of a file's own time that wants a frame. */
export interface Slot {
  /** `start / step`: the same index scheme at every zoom, because steps are powers of two. */
  index: number;
  start: number;
  end: number;
  /** True when the slot overlaps the visible range; false for the margin around it. */
  visible: boolean;
}

/**
 * The slot step for a tile span: `0.25 s × 2^n`, rounded down, never below 0.25 s. Because
 * steps are dyadic, a slot at one zoom is exactly the union of the slots at the next finer
 * one, so frames decoded at any zoom fill the slots of every coarser zoom.
 */
export function slotStepFor(tileSpan: number): number {
  if (!Number.isFinite(tileSpan) || tileSpan <= MIN_SLOT_STEP) return MIN_SLOT_STEP;
  let step = MIN_SLOT_STEP * 2 ** Math.floor(Math.log2(tileSpan / MIN_SLOT_STEP));
  // Math.log2 can land one step off near a power of two; settle it exactly.
  while (step * 2 <= tileSpan) step *= 2;
  while (step > tileSpan && step > MIN_SLOT_STEP) step /= 2;
  return step;
}

export interface PlanSlotsInput {
  /** The file's duration, in its own time. Not finite or not positive: nothing is planned. */
  duration: number;
  /** What the user sees, in the file's own time. */
  visible: TimeRange;
  /** Seconds of the file one tile spans at the current zoom (visible seconds ÷ visible tiles). */
  tileSpan: number;
  /** The file's stored frames, sorted by timestamp (a store snapshot). */
  frames: readonly { timestamp: number }[];
  /** Extra range planned on each side. Default: one screen (the visible length). */
  margin?: number;
}

/**
 * The empty slots of the visible range plus its margin, sorted by start.
 *
 * A slot is filled when a stored frame sits inside it. At fit zoom (the visible range is the
 * whole file) the step grows until at most {@link FIT_FRAME_CAP} slots cover the file, so a
 * fit plan asks for at most that many frames, evenly spread, and never for a slot that
 * already holds one. Frames decoded while zoomed in do not count against that cap: counting
 * them would leave the far stretches of the file without a frame of their own time.
 * A zoomed-in plan is bounded by {@link MAX_PLAN_SLOTS} the same way, so no input (a tiny
 * tile span, a file reporting 17.8 hours) can ask for an unbounded list.
 */
export function planSlots(input: PlanSlotsInput): Slot[] {
  const { duration, tileSpan, frames } = input;
  if (!Number.isFinite(duration) || duration <= 0) return [];
  if (!Number.isFinite(input.visible.start) || !Number.isFinite(input.visible.end)) return [];
  const visibleStart = Math.max(0, input.visible.start);
  const visibleEnd = Math.min(duration, input.visible.end);
  if (visibleEnd <= visibleStart) return [];

  const fit = input.visible.start <= 0 && input.visible.end >= duration;
  const margin = Math.max(0, input.margin ?? visibleEnd - visibleStart);
  const rangeStart = Math.max(0, visibleStart - margin);
  const rangeEnd = Math.min(duration, visibleEnd + margin);

  const limit = fit ? FIT_FRAME_CAP : MAX_PLAN_SLOTS;
  let step = slotStepFor(tileSpan);
  const slotCount = (s: number) => Math.ceil(rangeEnd / s) - Math.floor(rangeStart / s);
  while (slotCount(step) > limit) step *= 2;

  const empty: Slot[] = [];
  for (let n = Math.floor(rangeStart / step); n < Math.ceil(rangeEnd / step); n++) {
    const start = n * step;
    const end = start + step;
    if (start >= duration) break;
    const at = lowerBound(frames, start);
    if (at < frames.length && frames[at].timestamp < end) continue;
    empty.push({ index: n, start, end, visible: end > visibleStart && start < visibleEnd });
  }

  return empty;
}

export interface PlanTileSlotsInput {
  /** The file's duration, in its own time. Not finite or not positive: nothing is planned. */
  duration: number;
  /** The clip block's stretch of the file, in the file's own time. */
  clip: TimeRange;
  /** How many equal tiles the block is drawn as (the same count `thumbnailTiles` uses). */
  count: number;
  /** What the user sees of the clip, in the file's own time. */
  visible: TimeRange;
  /** The file's stored frames, sorted by timestamp (a store snapshot plus the opening ones). */
  frames: readonly { timestamp: number }[];
  /** Extra range planned on each side. Default: one screen (the visible length). */
  margin?: number;
}

/**
 * One slot per tile that has no frame of its own time yet, for the visible range and the margin.
 *
 * The slot is the middle half of the tile's span, so whatever frame fills it is inside the tile
 * (AC1, AC2) and near its centre. A grid of fixed slots cannot promise that: a slot that is
 * larger than half a tile can straddle two tiles and leave both without a frame inside its own
 * span, which is what a 9.5-second tile over an 8-second grid did. A tile already holding a
 * frame inside its span, from any earlier zoom or from the opening strip, is not asked for again.
 * Sorted by start; the visible ones are flagged. At most {@link MAX_PLAN_SLOTS}, visible first.
 */
export function planTileSlots(input: PlanTileSlotsInput): Slot[] {
  const { duration, clip, count, frames } = input;
  if (!Number.isFinite(duration) || duration <= 0) return [];
  if (!Number.isFinite(input.visible.start) || !Number.isFinite(input.visible.end)) return [];
  const clipLength = clip.end - clip.start;
  if (!(clipLength > 0) || !(count >= 1)) return [];
  const span = clipLength / count;
  const visibleStart = Math.max(clip.start, input.visible.start);
  const visibleEnd = Math.min(clip.end, input.visible.end);
  if (visibleEnd <= visibleStart) return [];

  const margin = Math.max(0, input.margin ?? visibleEnd - visibleStart);
  const first = Math.max(0, Math.floor((visibleStart - margin - clip.start) / span));
  const last = Math.min(count - 1, Math.ceil((visibleEnd + margin - clip.start) / span) - 1);

  const slots: Slot[] = [];
  for (let i = first; i <= last; i++) {
    const start = clip.start + i * span;
    const end = Math.min(start + span, duration);
    if (end <= start) break; // past the end of the file
    const at = lowerBound(frames, start);
    if (at < frames.length && frames[at].timestamp < end) continue;
    const centre = (start + end) / 2;
    const quarter = (end - start) / 4;
    slots.push({
      index: i,
      start: centre - quarter,
      end: centre + quarter,
      visible: end > visibleStart && start < visibleEnd,
    });
  }
  if (slots.length <= MAX_PLAN_SLOTS) return slots;
  return [...slots.filter((s) => s.visible), ...slots.filter((s) => !s.visible)]
    .slice(0, MAX_PLAN_SLOTS)
    .sort((a, b) => a.start - b.start);
}

// ---------------------------------------------------------------------------------------
// Tile lookup
// ---------------------------------------------------------------------------------------

/** The frame in `frames[lo, hi)` nearest to `target`; the earlier one on a tie. */
function nearestIn<F extends { timestamp: number }>(
  frames: readonly F[],
  lo: number,
  hi: number,
  target: number,
): F | null {
  if (lo >= hi) return null;
  const at = Math.min(hi, Math.max(lo, lowerBound(frames, target)));
  const before = at > lo ? frames[at - 1] : null;
  const after = at < hi ? frames[at] : null;
  if (!before) return after;
  if (!after) return before;
  return target - before.timestamp <= after.timestamp - target ? before : after;
}

/**
 * The frame a tile shows, from a file's frames sorted by timestamp:
 *
 * 1. the frame nearest the tile's centre among those inside the tile's span (and the clip);
 * 2. else the nearest among those inside the clip's source range;
 * 3. else the nearest in the file, so a tile is never empty while the file has any frame.
 *
 * A frame from outside the clip is never chosen while one inside it exists. Ranges are
 * half-open, so a frame exactly at a tile's or a clip's end belongs to the next one. Null
 * only when `frames` is empty. (A companion file that does not cover this part of the
 * source at all is the caller's business: it decides not to look a frame up.)
 */
export function pickFrame<F extends { timestamp: number }>(
  frames: readonly F[],
  tile: TimeRange,
  clip: TimeRange,
): F | null {
  const centre = (tile.start + tile.end) / 2;
  const clipLo = lowerBound(frames, clip.start);
  const clipHi = lowerBound(frames, clip.end);
  const inTile = nearestIn(
    frames,
    Math.max(clipLo, lowerBound(frames, tile.start)),
    Math.min(clipHi, lowerBound(frames, tile.end)),
    centre,
  );
  return (
    inTile ??
    nearestIn(frames, clipLo, clipHi, centre) ??
    nearestIn(frames, 0, frames.length, centre)
  );
}
