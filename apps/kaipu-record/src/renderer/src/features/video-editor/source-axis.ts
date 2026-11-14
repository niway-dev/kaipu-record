/**
 * Pure source-axis math: the ONLY place that maps a time on the scene's source axis to a
 * recording and a local second, as timeline.ts is for timeline ↔ source (ADR 0058).
 *
 * A scene has one source axis. The opened recording sits at [0, primaryDuration]; every joined
 * recording sits at its own fixed [offset, offset + duration], with a gap in between so an axis
 * time belongs to at most one recording. Everything per-recording (clips, zooms, redactions,
 * mutes, webcam segments, source anchors) stays a plain axis number; only a media reader (the
 * `<video>`, the export decoder, cursor and webcam files) translates, through `recordingAt` or
 * `resolveAt`. Private copies of this lookup WILL put a zoom on the wrong recording.
 */
import { newId, type SceneSource, type TrackItem, type VideoScene } from "./scene";
import {
  MIN_ITEM_DURATION,
  boundaryIndexAt,
  insertItemAt,
  timelineToSource,
  toLayout,
  type LayoutEntry,
} from "./timeline";

export interface AxisRecording {
  /** The `SceneSource.id`; null = the opened recording. */
  sourceId: string | null;
  offset: number;
  duration: number;
}

export interface SourceAxis {
  /** Sorted by offset; [0] is the opened recording. */
  recordings: AxisRecording[];
}

export function sourceAxis(primaryDuration: number, sources?: readonly SceneSource[]): SourceAxis {
  const joined = (sources ?? [])
    .map((s) => ({ sourceId: s.id, offset: s.offset, duration: s.durationSeconds }))
    .sort((a, b) => a.offset - b.offset);
  return { recordings: [{ sourceId: null, offset: 0, duration: primaryDuration }, ...joined] };
}

/**
 * The recording whose range holds `axisTime`, ends included (ranges never touch), and the local
 * second inside it. Null in a gap or outside every range.
 */
export function recordingAt(
  axis: SourceAxis,
  axisTime: number,
): { recording: AxisRecording; localTime: number } | null {
  for (const recording of axis.recordings) {
    if (axisTime >= recording.offset && axisTime <= recording.offset + recording.duration) {
      return { recording, localTime: axisTime - recording.offset };
    }
  }
  return null;
}

/**
 * Which recording and which local second the sequence shows at timeline time `t`. A slide has
 * no recording; its `axisTime` and `localTime` are the slide's own clock. Null on an empty layout.
 */
export function resolveAt(
  layout: LayoutEntry[],
  axis: SourceAxis,
  t: number,
): {
  entry: LayoutEntry;
  recording: AxisRecording | null;
  axisTime: number;
  localTime: number;
} | null {
  const hit = timelineToSource(layout, t);
  if (!hit) return null;
  const { entry, sourceTime } = hit;
  if (entry.kind !== "clip") {
    return { entry, recording: null, axisTime: sourceTime, localTime: sourceTime };
  }
  const found = recordingAt(axis, sourceTime);
  return {
    entry,
    recording: found ? found.recording : null,
    axisTime: sourceTime,
    localTime: found ? found.localTime : sourceTime,
  };
}

/**
 * The range of the recording a clip belongs to (by its `sourceStart`): what a trim may not
 * leave. Falls back to the whole axis when no range holds it (a legacy clip), so it is never
 * trapped.
 */
export function clipBounds(
  axis: SourceAxis,
  clip: { sourceStart: number },
): { start: number; end: number } {
  const found = recordingAt(axis, clip.sourceStart);
  return found
    ? { start: found.recording.offset, end: found.recording.offset + found.recording.duration }
    : { start: 0, end: Infinity };
}

export const AXIS_GRID_SECONDS = 3600;
export const AXIS_GAP_SECONDS = 60;

/**
 * Offset for a new join: the next multiple of `AXIS_GRID_SECONDS` at or after the end of the
 * last range plus `AXIS_GAP_SECONDS`. It only picks new offsets; stored ones never move.
 */
export function nextOffset(axis: SourceAxis): number {
  const end = Math.max(0, ...axis.recordings.map((r) => r.offset + r.duration));
  return Math.ceil((end + AXIS_GAP_SECONDS) / AXIS_GRID_SECONDS) * AXIS_GRID_SECONDS;
}

export interface JoinedRecordingInput {
  assetId: string;
  title: string;
  durationSeconds: number;
  width: number;
  height: number;
}

/**
 * Join a recording: append a `SceneSource` at `nextOffset` and insert ONE clip covering all of it
 * at the clip boundary nearest timeline time `t`. Pure, so one join is one scene change (one undo
 * step for the caller). The same `assetId` joined again is an independent new source.
 */
export function joinRecording(
  scene: VideoScene,
  primaryDuration: number,
  recording: JoinedRecordingInput,
  t: number,
): { scene: VideoScene; source: SceneSource } {
  // The session loader rejects a shorter range (it could not hold its clip): callers filter first.
  if (!(recording.durationSeconds >= MIN_ITEM_DURATION)) {
    throw new RangeError(`joinRecording: ${recording.durationSeconds}s is shorter than a clip`);
  }
  const axis = sourceAxis(primaryDuration, scene.sources);
  const source: SceneSource = {
    id: newId(),
    assetId: recording.assetId,
    title: recording.title,
    offset: nextOffset(axis),
    durationSeconds: recording.durationSeconds,
    width: recording.width,
    height: recording.height,
  };
  const clip: TrackItem = {
    id: newId(),
    kind: "clip",
    sourceStart: source.offset,
    sourceEnd: source.offset + source.durationSeconds,
  };
  const layout = toLayout(scene.items);
  const items = insertItemAt(scene.items, itemsIndexOfBoundary(scene.items, layout, t), clip);
  return { scene: { ...scene, items, sources: [...(scene.sources ?? []), source] }, source };
}

/** `boundaryIndexAt` counts layout entries, which skip empty items: map it back onto `items`. */
function itemsIndexOfBoundary(items: TrackItem[], layout: LayoutEntry[], t: number): number {
  const boundary = boundaryIndexAt(layout, t);
  if (boundary === 0) return 0;
  const after = items.findIndex((item) => item.id === layout[boundary - 1].itemId);
  return after + 1;
}
