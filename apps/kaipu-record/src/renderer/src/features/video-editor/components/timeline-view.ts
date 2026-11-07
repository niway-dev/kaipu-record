/**
 * The timeline's zoom and scroll, as one pure value every lane reads (NIW2-667, spec
 * section 5). It answers the only two questions the strip ever asks about geometry:
 * "which time is under this pixel?" ({@link timeAt}) and "which pixel is this time on?"
 * ({@link xOf}). Every pointer-to-time conversion in the editor goes through `timeAt`; a
 * lane that divides by its own width again is the bug this module exists to prevent (a
 * drag at 4x moving by the 1x amount).
 *
 * Zoom is a FACTOR relative to fit, not a pixel scale: `zoom = 1` shows the whole
 * timeline in the lane, `zoom = 4` makes the content four lanes wide. A factor survives a
 * cut — deleting a clip at 4x leaves the content four lanes wide and re-fits what is left
 * — where a fixed pixels-per-second would make the remaining footage jump apart.
 *
 * Pure and DOM-free; the zoom-and-scroll state lives in `use-timeline-view.ts`.
 */

export interface TimelineView {
  /** Zoom relative to fit: 1 shows the whole timeline in the lane. Within `[1, maxZoom]`. */
  zoom: number;
  /** Pixels scrolled from the start. 0 at fit; within `[0, contentWidth - laneWidth]`. */
  scroll: number;
  /** Width of the visible lane in CSS px (the labels column is not part of it). */
  laneWidth: number;
  /** Timeline length in seconds (the cut layout's duration, not the source's). */
  duration: number;
}

/** The deepest zoom: one second of timeline is this wide (a 30 fps frame is 8 px). */
export const MAX_PX_PER_SECOND = 240;

/** `−` and `+` step the zoom by this factor (two steps double it). */
export const ZOOM_STEP = Math.SQRT2;

/** While playing, the view scrolls once the playhead passes this share of the lane. */
export const FOLLOW_EDGE = 0.8;

/** …and puts the playhead back at this share of the lane (a page turn, not a crawl). */
export const FOLLOW_LANDING = 0.2;

/** A wheel event moves the zoom by at most e^0.4 (about 1.49x). */
const WHEEL_MAX_DELTA_PX = 40;
const WHEEL_SENSITIVITY = 0.01;
const WHEEL_LINE_PX = 16;
const WHEEL_PAGE_PX = 400;

const EPSILON = 1e-6;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

/** The whole timeline in the lane, scrolled to the start. */
export function fitView(laneWidth: number, duration: number): TimelineView {
  return { zoom: 1, scroll: 0, laneWidth, duration };
}

/** Pixels per timeline second at fit (0 while the lane or the timeline is unmeasured). */
function fitScale(laneWidth: number, duration: number): number {
  return laneWidth > 0 && duration > 0 ? laneWidth / duration : 0;
}

/** The highest zoom for this lane and duration. At least 1: a short clip never zooms out. */
export function maxZoom(laneWidth: number, duration: number): number {
  const fit = fitScale(laneWidth, duration);
  return fit > 0 ? Math.max(1, MAX_PX_PER_SECOND / fit) : 1;
}

/** Pixels per timeline second right now. */
export function scaleOf(view: TimelineView): number {
  return fitScale(view.laneWidth, view.duration) * view.zoom;
}

/** Width of everything the lane could scroll through. */
export function contentWidth(view: TimelineView): number {
  return view.laneWidth * view.zoom;
}

/** Re-establish the invariants: zoom in `[1, maxZoom]`, scroll in `[0, content - lane]`. */
export function clampView(view: TimelineView): TimelineView {
  const zoom = clamp(finiteOr(view.zoom, 1), 1, maxZoom(view.laneWidth, view.duration));
  const content = view.laneWidth * zoom;
  const scroll = clamp(finiteOr(view.scroll, 0), 0, Math.max(0, content - view.laneWidth));
  if (zoom === view.zoom && scroll === view.scroll) return view;
  return { ...view, zoom, scroll };
}

/**
 * Move from view `from` to view `to` (a resized lane, a cut or a stretched take) keeping the
 * TIME at the lane's left edge: the scroll is in pixels and the scale (pixels per second)
 * follows the lane width and the duration, so carrying the pixels over would move the window
 * the user is looking at. `to`'s zoom is clamped first, because a different lane or duration
 * has a different deepest zoom, and the scroll is then set for that zoom's scale and clamped
 * to the new content (a cut that removed the old left edge lands on the end of what is
 * left). When either side has no scale yet (an unmeasured lane, an empty timeline) there is
 * no window to keep and the scroll is only clamped; when the scale did not change the view is
 * returned as it is, so no float error invents a change.
 */
export function keepLeftEdge(from: TimelineView, to: TimelineView): TimelineView {
  const before = scaleOf(from);
  const zoom = clamp(finiteOr(to.zoom, 1), 1, maxZoom(to.laneWidth, to.duration));
  const after = scaleOf({ ...to, zoom });
  if (before <= 0 || after <= 0 || after === before) return clampView(to);
  return clampView({ ...to, zoom, scroll: (from.scroll / before) * after });
}

/**
 * The timeline time under a pointer. `laneLeft` is the screen x of the lane's left edge
 * (the viewport's, which does not move when the content scrolls). Clamped to the
 * timeline by default; a drag that moves an EDGE by a pointer delta passes `clampToTimeline = false`
 * so it can pull a trimmed clip back out past the end of the visible timeline.
 */
export function timeAt(
  view: TimelineView,
  clientX: number,
  laneLeft: number,
  clampToTimeline = true,
): number {
  const scale = scaleOf(view);
  if (scale <= 0) return 0;
  const t = (clientX - laneLeft + view.scroll) / scale;
  return clampToTimeline ? clamp(t, 0, view.duration) : t;
}

/**
 * Timeline seconds between two pointer positions, UNCLAMPED, for dragging an edge by a
 * delta: a trimmed clip's end handle must be able to travel past the end of the visible
 * timeline to win footage back. Goes through {@link timeAt} like every other conversion.
 */
export function timeDelta(view: TimelineView, fromClientX: number, toClientX: number): number {
  return timeAt(view, toClientX, 0, false) - timeAt(view, fromClientX, 0, false);
}

/** Where a time sits in the visible lane: px from its left edge (negative: scrolled off). */
export function xOf(view: TimelineView, t: number): number {
  return t * scaleOf(view) - view.scroll;
}

/**
 * Zoom by `factor` keeping the time under `anchorClientX` on the same pixel. An anchor
 * outside the lane (the labels column, past the end) counts as the nearest edge.
 */
export function zoomAt(
  view: TimelineView,
  factor: number,
  anchorClientX: number,
  laneLeft: number,
): TimelineView {
  const scale = scaleOf(view);
  if (scale <= 0 || !Number.isFinite(factor) || factor <= 0) return view;
  const anchorX = clamp(anchorClientX - laneLeft, 0, view.laneWidth);
  const anchorTime = (anchorX + view.scroll) / scale;
  const zoom = clamp(view.zoom * factor, 1, maxZoom(view.laneWidth, view.duration));
  const nextScale = fitScale(view.laneWidth, view.duration) * zoom;
  return clampView({ ...view, zoom, scroll: anchorTime * nextScale - anchorX });
}

/** Scroll by `dx` pixels, clamped. */
export function panBy(view: TimelineView, dx: number): TimelineView {
  return clampView({ ...view, scroll: view.scroll + dx });
}

function withScroll(view: TimelineView, scroll: number): TimelineView {
  const next = clampView({ ...view, scroll });
  return Math.abs(next.scroll - view.scroll) < EPSILON ? view : next;
}

/**
 * Keep a PLAYING playhead on screen: once it passes {@link FOLLOW_EDGE} of the lane (or
 * is somehow off it) the view turns the page, putting it at {@link FOLLOW_LANDING}.
 * Returns the same object when nothing needs to move, so callers can skip the update.
 * Whether to follow at all (the user took over by panning) is the caller's state.
 */
export function followPlayhead(view: TimelineView, t: number): TimelineView {
  if (contentWidth(view) - view.laneWidth < EPSILON) return view;
  const x = xOf(view, t);
  if (x >= 0 && x <= view.laneWidth * FOLLOW_EDGE) return view;
  return withScroll(view, t * scaleOf(view) - view.laneWidth * FOLLOW_LANDING);
}

/**
 * Scroll only if `t` is off screen (a seek by keyboard or button while paused): unlike
 * {@link followPlayhead} it leaves a playhead that is visible alone, so clicking near the
 * right edge of the ruler does not make the view jump under the pointer.
 */
export function revealTime(view: TimelineView, t: number): TimelineView {
  if (contentWidth(view) - view.laneWidth < EPSILON) return view;
  const x = xOf(view, t);
  if (x >= 0 && x <= view.laneWidth) return view;
  return withScroll(view, t * scaleOf(view) - view.laneWidth * FOLLOW_LANDING);
}

/** The window of timeline time the lane shows. */
export function visibleRange(view: TimelineView): { start: number; end: number } {
  const scale = scaleOf(view);
  if (scale <= 0) return { start: 0, end: 0 };
  return {
    start: clamp(view.scroll / scale, 0, view.duration),
    end: clamp((view.scroll + view.laneWidth) / scale, 0, view.duration),
  };
}

const zoomFormats = new Map<string, Intl.NumberFormat>();

/**
 * A zoom factor as people read it in `locale`, always with one decimal: 4.0 in English, 4,0
 * in Spanish. Display only (the slider's accessible value); the zoom itself stays the number.
 */
export function formatZoom(zoom: number, locale: string): string {
  let format = zoomFormats.get(locale);
  if (!format) {
    format = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    zoomFormats.set(locale, format);
  }
  return format.format(zoom);
}

/** Zoom factor → slider position in `[0, 1]`, logarithmic: each step feels the same size.
 *  `max` is {@link maxZoom} for the lane; a lane that cannot zoom (max 1) pins it at 0. */
export function zoomToSlider(zoom: number, max: number): number {
  if (max <= 1) return 0;
  return clamp(Math.log(Math.max(1, zoom)) / Math.log(max), 0, 1);
}

/** The inverse of {@link zoomToSlider}. */
export function sliderToZoom(position: number, max: number): number {
  if (max <= 1) return 1;
  return Math.exp(clamp(position, 0, 1) * Math.log(max));
}

/**
 * The zoom factor for one wheel event (⌘/Ctrl + wheel, or a trackpad pinch, which Chromium
 * delivers as a wheel with ctrlKey). Scrolling up zooms in. Symmetric, so a pinch out and
 * back lands where it began; capped, so one mouse notch cannot cross the whole range.
 */
export function wheelZoomFactor(deltaY: number, deltaMode: number): number {
  const px =
    deltaMode === 1 ? deltaY * WHEEL_LINE_PX : deltaMode === 2 ? deltaY * WHEEL_PAGE_PX : deltaY;
  return Math.exp(-clamp(px, -WHEEL_MAX_DELTA_PX, WHEEL_MAX_DELTA_PX) * WHEEL_SENSITIVITY);
}
