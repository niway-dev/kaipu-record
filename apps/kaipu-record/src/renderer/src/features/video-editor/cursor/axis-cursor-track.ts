/**
 * One cursor track on the scene's source axis (ADR 0058). Each recording's track is in its OWN
 * milliseconds; the camera path, the activity marks and the pointer all read the axis, so a
 * joined recording's samples and clicks are shifted by its offset and appended after the opened
 * recording's. Pure.
 */
import type { CursorTrack } from "@shared/cursor-track";

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
