/**
 * Pure helpers that tell the timeline which recording each clip belongs to (ADR 0058), so a
 * sequence of joined recordings can label its clips, outline the siblings of a hovered one,
 * mark a missing file and span the stretches with no camera. Everything is keyed by the clip's
 * layout item id and derived from the one source axis (`recordingAt`), never a private copy of
 * that lookup. A scene without joined recordings has none of this: `clipRecordings` returns null.
 */
import { recordingAt, type SourceAxis } from "./source-axis";
import type { LayoutEntry } from "./timeline";

/** What the page knows about one recording of the scene; `sourceId` null = the opened one. */
export interface RecordingInfo {
  sourceId: string | null;
  title: string;
  status: "ready" | "loading" | "missing";
  hasWebcam: boolean;
}

/** The recording one clip belongs to, with where its range starts on the source axis. */
export interface ClipRecording extends RecordingInfo {
  /** Axis seconds of the recording's first frame: local time = axis time - offset. */
  offset: number;
}

export type ClipRecordings = ReadonlyMap<string, ClipRecording>;

/**
 * The recording of every CLIP in the layout, by item id (a slide has none, and neither has a
 * legacy clip whose `sourceStart` no range holds). Null when the scene has no joined recording
 * (the axis has only the opened one): the timeline then renders exactly as before.
 */
export function clipRecordings(
  layout: readonly LayoutEntry[],
  axis: SourceAxis,
  recordings: readonly RecordingInfo[],
): ClipRecordings | null {
  if (axis.recordings.length <= 1) return null;
  const infoOf = new Map(recordings.map((r) => [r.sourceId, r]));
  const out = new Map<string, ClipRecording>();
  for (const entry of layout) {
    if (entry.kind !== "clip") continue;
    const found = recordingAt(axis, entry.sourceStart);
    const info = found ? infoOf.get(found.recording.sourceId) : undefined;
    if (!found || !info) continue;
    out.set(entry.itemId, { ...info, offset: found.recording.offset });
  }
  return out;
}

/** The clips of the same recording as `hoveredItemId`, itself included; empty when none. */
export function sameRecordingItemIds(
  clips: ClipRecordings | null,
  hoveredItemId: string | null,
): ReadonlySet<string> {
  const hovered = clips && hoveredItemId !== null ? clips.get(hoveredItemId) : undefined;
  if (!clips || !hovered) return new Set();
  const ids = new Set<string>();
  for (const [itemId, clip] of clips) if (clip.sourceId === hovered.sourceId) ids.add(itemId);
  return ids;
}

/**
 * The clips to cover with "No camera in this recording": those whose recording is known to
 * have no webcam while some other recording of the scene has one. A recording still loading or
 * missing is unknown, not "no camera".
 */
export function noCameraItemIds(
  clips: ClipRecordings | null,
  anyRecordingHasWebcam: boolean,
): ReadonlySet<string> {
  const ids = new Set<string>();
  if (!clips || !anyRecordingHasWebcam) return ids;
  for (const [itemId, clip] of clips) {
    if (clip.status === "ready" && !clip.hasWebcam) ids.add(itemId);
  }
  return ids;
}

/** Timeline seconds where one clip ends and the next belongs to a different recording. */
export function recordingBoundaries(
  layout: readonly LayoutEntry[],
  clips: ClipRecordings | null,
): number[] {
  if (!clips) return [];
  const times: number[] = [];
  for (let i = 1; i < layout.length; i++) {
    const before = clips.get(layout[i - 1].itemId);
    const after = clips.get(layout[i].itemId);
    if (before && after && before.sourceId !== after.sourceId) times.push(layout[i].timelineStart);
  }
  return times;
}

/** A joined recording whose clips need thumbnails of its own file. */
export interface ThumbnailRecording {
  sourceId: string;
  /** The recording's length in its own file, which the filmstrip spans. */
  durationSeconds: number;
}

/**
 * The joined recordings that need a filmstrip: ready ones that still have a clip. A recording
 * whose clips were all deleted (or that is loading or missing) decodes nothing.
 */
export function recordingsNeedingThumbnails(
  clips: ClipRecordings | null,
  durations: ReadonlyMap<string, number>,
): ThumbnailRecording[] {
  if (!clips) return [];
  const seen = new Set<string>();
  const out: ThumbnailRecording[] = [];
  for (const clip of clips.values()) {
    const { sourceId } = clip;
    if (sourceId === null || clip.status !== "ready" || seen.has(sourceId)) continue;
    seen.add(sourceId);
    out.push({ sourceId, durationSeconds: durations.get(sourceId) ?? 0 });
  }
  return out;
}
