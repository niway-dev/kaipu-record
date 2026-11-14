/**
 * One cursor track on the scene's source axis (ADR 0058). Each recording's track is in its OWN
 * milliseconds; the camera path, the activity marks and the pointer all read the axis, so a
 * joined recording's samples and clicks are shifted by its offset and appended after the opened
 * recording's. Pure.
 *
 * Coordinates are NOT remapped here: a joined track of another aspect goes through
 * `frameCursorTrack` first, so every consumer reads the same frame-normalized points.
 */
import { isOnDisplay, type CursorTrack } from "@shared/cursor-track";
import { picturePointToFramePoint } from "../privacy/letterbox";

export interface JoinedCursorTrack {
  /** Start of the recording's range on the axis, in seconds. */
  offset: number;
  /** Its track in its own milliseconds; null when it has none (it adds nothing). */
  track: CursorTrack | null;
}

/**
 * The primary track as it is, then every joined track shifted by `offset * 1000` ms, in axis
 * order. `display` and `anchor` come from the primary (or the first track there is);
 * `clicksAvailable` is true when any track has click data. Null when every track is null. With
 * no joined track that holds data, the primary itself is returned.
 */
export function axisCursorTrack(
  primary: CursorTrack | null,
  joined: readonly JoinedCursorTrack[],
): CursorTrack | null {
  const shifted = joined
    .filter((j): j is { offset: number; track: CursorTrack } => j.track !== null)
    .sort((a, b) => a.offset - b.offset);
  if (shifted.length === 0) return primary;
  const first = primary ?? shifted[0].track;

  const t: number[] = primary ? [...primary.t] : [];
  const x: number[] = primary ? [...primary.x] : [];
  const y: number[] = primary ? [...primary.y] : [];
  const clicks = primary ? [...primary.clicks] : [];
  for (const { offset, track } of shifted) {
    const shiftMs = offset * 1000;
    for (let i = 0; i < track.t.length; i++) {
      t.push(track.t[i] + shiftMs);
      x.push(track.x[i]);
      y.push(track.y[i]);
    }
    for (const click of track.clicks) clicks.push({ ...click, t: click.t + shiftMs });
  }

  const out: CursorTrack = {
    version: 1,
    display: first.display,
    anchor: first.anchor,
    clicksAvailable:
      (primary?.clicksAvailable ?? false) || shifted.some((s) => s.track.clicksAvailable),
    t,
    x,
    y,
    clicks,
  };
  if (first.region) out.region = first.region;
  return out;
}

const SAME_ASPECT = 1e-6;

/**
 * A recording's track in FRAME coordinates. Its x/y are normalized to the recording's own picture
 * (display or area), but the preview frame has the OPENED recording's aspect and a recording of
 * another aspect is letterboxed inside it (ADR 0058), so the overlay, the camera path and the
 * auto-zoom detection all need the point where the pointer is on the frame, bars included.
 * Samples and clicks are mapped once here and nothing downstream remaps them.
 *
 * Same aspect (or an unknown one, 0) returns the track itself. A point that was OFF the display
 * stays off it: mapped inside the frame it would otherwise sit on a bar and look like a pointer.
 * `display` is rescaled so the detector's distances (a fraction of the diagonal) stay what they
 * were on the recording's own picture.
 */
export function frameCursorTrack(
  track: CursorTrack,
  frameAspect: number,
  pictureAspect: number,
): CursorTrack;
export function frameCursorTrack(
  track: CursorTrack | null,
  frameAspect: number,
  pictureAspect: number,
): CursorTrack | null;
export function frameCursorTrack(
  track: CursorTrack | null,
  frameAspect: number,
  pictureAspect: number,
): CursorTrack | null {
  if (!track) return null;
  const usable = frameAspect > 0 && pictureAspect > 0;
  if (!usable || Math.abs(frameAspect - pictureAspect) <= SAME_ASPECT * frameAspect) return track;

  const map = (p: { x: number; y: number }): { x: number; y: number } => {
    const out = picturePointToFramePoint(p, frameAspect, pictureAspect);
    return !isOnDisplay(p) && isOnDisplay(out) ? { x: -1, y: -1 } : out;
  };
  const x: number[] = [];
  const y: number[] = [];
  for (let i = 0; i < track.t.length; i++) {
    const p = map({ x: track.x[i], y: track.y[i] });
    x.push(p.x);
    y.push(p.y);
  }
  const clicks = track.clicks.map((c) => ({ ...c, ...map(c) }));

  // Frame units are stretched on one axis (by `scale`); undo that on the display, then keep the
  // diagonal, so a distance in frame units is the same fraction of the diagonal as before.
  const narrow = pictureAspect < frameAspect;
  const scale = narrow ? pictureAspect / frameAspect : frameAspect / pictureAspect;
  const w = narrow ? track.display.width / scale : track.display.width;
  const h = narrow ? track.display.height : track.display.height / scale;
  const keep = Math.hypot(track.display.width, track.display.height) / Math.hypot(w, h);
  return {
    ...track,
    display: { ...track.display, width: w * keep, height: h * keep },
    x,
    y,
    clicks,
  };
}

/** One recording on the source axis, as the cursor layer sees it. */
export interface OverlayRecording {
  /** Start of its range on the axis, in seconds (0 for the opened recording). */
  offset: number;
  /** Length of the recording in seconds. */
  duration: number;
  /** Its track in its own milliseconds, already in frame coordinates; null when it has none. */
  track: CursorTrack | null;
  /** Whether ITS pixels are free of the pointer (`canOverlayRecordedCursor(its capture)`). */
  canOverlay: boolean;
}

/** Past the end of a range by this much the pointer is gone; the range's own last frame keeps it. */
const RANGE_END_MS = 0.5;

/**
 * The track the cursor layer draws, on the source axis. A pointer is drawn during a recording's
 * range only when THAT recording has a track and its own pixels exclude the pointer (the camera
 * path and the auto zooms read every recording's track regardless: provenance decides only
 * whether the overlay is drawn). Everywhere else the track is off the display, so the layer
 * draws nothing: in a recording without a track, in one whose footage already holds the pointer,
 * and in the gaps. `sampleCursor` clamps to the end samples, so each range carries explicit
 * off-display break samples around it, and the pointer holds its first and last position inside.
 *
 * With no joined recording the opened one is the whole axis: its track itself is returned (or
 * null when it cannot be overlaid), so a scene without joins is unchanged.
 */
export function axisOverlayTrack(
  opened: OverlayRecording,
  joined: readonly OverlayRecording[],
): CursorTrack | null {
  const eligible = (r: OverlayRecording): r is OverlayRecording & { track: CursorTrack } =>
    r.canOverlay && r.track !== null && r.track.t.length > 0;
  if (joined.length === 0) return eligible(opened) ? opened.track : null;

  const ranges = [opened, ...joined].sort((a, b) => a.offset - b.offset);
  const t: number[] = [];
  const x: number[] = [];
  const y: number[] = [];
  const clicks: CursorTrack["clicks"] = [];
  const push = (at: number, px: number, py: number): void => {
    t.push(t.length > 0 ? Math.max(at, t[t.length - 1]) : at);
    x.push(px);
    y.push(py);
  };
  let first: CursorTrack | null = null;
  let clicksAvailable = false;

  for (let index = 0; index < ranges.length; index++) {
    const range = ranges[index];
    if (!eligible(range)) continue;
    const { track } = range;
    const startMs = range.offset * 1000;
    const durationMs = range.duration * 1000;
    const next = ranges[index + 1];
    const endMs = Math.min(
      startMs + durationMs + RANGE_END_MS,
      next ? next.offset * 1000 : Infinity,
    );
    const inside: number[] = [];
    for (let i = 0; i < track.t.length; i++) {
      if (track.t[i] >= 0 && track.t[i] <= durationMs) inside.push(i);
    }
    if (inside.length === 0) continue;
    first ??= track;
    clicksAvailable ||= track.clicksAvailable;

    push(startMs, -1, -1);
    const head = inside[0];
    if (track.t[head] > 0) push(startMs, track.x[head], track.y[head]);
    for (const i of inside) push(startMs + track.t[i], track.x[i], track.y[i]);
    const tail = inside[inside.length - 1];
    if (track.t[tail] < durationMs) push(startMs + durationMs, track.x[tail], track.y[tail]);
    push(endMs, -1, -1);
    for (const click of track.clicks) {
      if (click.t >= 0 && click.t <= durationMs) clicks.push({ ...click, t: click.t + startMs });
    }
  }
  const base: CursorTrack | null = first;
  if (!base) return null;
  const out: CursorTrack = {
    version: 1,
    display: base.display,
    anchor: base.anchor,
    clicksAvailable,
    t,
    x,
    y,
    clicks,
  };
  if (base.region) out.region = base.region;
  return out;
}
