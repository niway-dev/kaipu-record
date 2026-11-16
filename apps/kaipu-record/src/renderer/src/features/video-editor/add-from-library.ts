import type { LibraryVideo } from "@renderer/features/library/types";
import type { SlideItem, VideoScene } from "./scene";
import {
  boundaryIndexAt,
  insertItemAt,
  MIN_ITEM_DURATION,
  toLayout,
  type LayoutEntry,
} from "./timeline";

/**
 * The recordings the Add from Library modal offers (NIW2-782, NIW2-790): the Library's own recordings, other
 * than the one being edited, that can become a clip. An export (derived from another recording),
 * a cloud-only item (no local file), a recording whose sidecar could not be read and one too
 * short for a clip are left out. A recording the scene already joined stays: joining it again
 * is a new copy by design (`joinRecording`). `query` is a case-insensitive match on the title
 * after trimming; a blank one lists everything. Newest first.
 */
export function joinableRecordings(
  videos: readonly LibraryVideo[],
  openedAssetId: string,
  query: string,
): LibraryVideo[] {
  const needle = query.trim().toLowerCase();
  return videos
    .filter(
      (video) =>
        video.kind === "recording" &&
        video.id !== null &&
        video.durationSeconds >= MIN_ITEM_DURATION &&
        video.derivedFromAssetId === null &&
        !video.metadataIssue &&
        video.assetId !== openedAssetId &&
        (needle === "" || video.title.toLowerCase().includes(needle)),
    )
    .sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * The screenshots the Screenshots tab offers (NIW2-790): the Library's own screenshots that have
 * a local file (`readScreenshotBytes` reads it by id, so a cloud-only one cannot be added).
 * GIFs are left out on purpose: a GIF export is an animated MP4-sized file, not a still, and a
 * floating image is drawn from one PNG. `query` is a case-insensitive title match after
 * trimming; a blank one lists everything. Newest first.
 */
export function libraryScreenshots(videos: readonly LibraryVideo[], query: string): LibraryVideo[] {
  const needle = query.trim().toLowerCase();
  return videos
    .filter(
      (video) =>
        video.kind === "screenshot" &&
        video.id !== null &&
        (needle === "" || video.title.toLowerCase().includes(needle)),
    )
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** "1440 × 1080" from how the recording was captured; null when the size is unknown. */
export function resolutionLabel(video: Pick<LibraryVideo, "capture">): string | null {
  const width = video.capture?.width ?? 0;
  const height = video.capture?.height ?? 0;
  return width > 0 && height > 0 ? `${width} × ${height}` : null;
}

/**
 * The type a dragged Library row carries in `dataTransfer` (its value is the recording's
 * asset id). A drag of anything else, a file from Finder or text, never lights the timeline up.
 */
export const RECORDING_DRAG_MIME = "application/x-kaipu-recording";

/**
 * Where a recording dropped at timeline time `t` would land: `index` in the scene's items and
 * `time`, that boundary's second on the timeline, which is where the indicator is drawn. The
 * index is `boundaryIndexAt`'s, the rule the join itself applies to the time it is handed, so
 * dropping at `time` inserts exactly where the indicator was.
 */
export function insertBoundaryAt(
  layout: LayoutEntry[],
  t: number,
): { index: number; time: number } {
  const index = boundaryIndexAt(layout, t);
  return { index, time: index === 0 ? 0 : layout[index - 1].timelineEnd };
}

/**
 * Where clicking a Library recording lands when the playhead is at `t` (NIW2-788): after the
 * clip under the playhead, not at the nearest boundary. A playhead inside a clip, or exactly at
 * its end, means that clip, so one exactly at a clip's start means the clip before it; at 0 or
 * before, the first clip. At or past the end of the sequence it is the end; an empty sequence, 0.
 * Slides count as clips. Dropping keeps `insertBoundaryAt`'s nearest boundary.
 */
export function boundaryAfterClipAt(
  layout: LayoutEntry[],
  t: number,
): { index: number; time: number } {
  const found = layout.findIndex((entry) => t <= entry.timelineEnd);
  const index = found === -1 ? layout.length : found + 1;
  return { index, time: index === 0 ? 0 : layout[index - 1].timelineEnd };
}

/**
 * The mirror of `boundaryAfterClipAt` (NIW2-829): before the clip under the playhead, which is
 * the same clip that rule picks (inside it, or exactly at its end, so a playhead exactly on a
 * cut means the clip before the cut). Past the end of the sequence there is no clip under the
 * playhead, so it is the end, as for "after"; an empty sequence, 0.
 */
export function boundaryBeforeClipAt(
  layout: LayoutEntry[],
  t: number,
): { index: number; time: number } {
  const found = layout.findIndex((entry) => t <= entry.timelineEnd);
  const index = found === -1 ? layout.length : found;
  return { index, time: index === 0 ? 0 : layout[index - 1].timelineEnd };
}

/** Add at start: before the first clip. */
export function boundaryAtStart(): { index: number; time: number } {
  return { index: 0, time: 0 };
}

/** Add at end: after the last clip (`index` is the layout length); 0 for an empty sequence. */
export function boundaryAtEnd(layout: LayoutEntry[]): { index: number; time: number } {
  return {
    index: layout.length,
    time: layout.length === 0 ? 0 : layout[layout.length - 1].timelineEnd,
  };
}

/**
 * The boundary `at` names on `layout` (a time: the nearest one, for a drop; or a boundary already
 * chosen, for a click), pinned to the clip that FOLLOWS it (null: the end of the sequence), as a
 * function of the scene a join composes from. A join waits behind earlier ones,
 * and one that inserted a clip ahead of the boundary moves it: the anchor moves with it, so the
 * recording lands where the user dropped it. Following the clip, and the end, keeps two quick
 * adds at the end in the order they were made. If the anchor clip was removed meanwhile, the
 * original boundary time stands. The scene's layout is `joinRecording`'s own (`toLayout`).
 */
export function anchoredBoundary(
  layout: LayoutEntry[],
  at: number | { index: number; time: number },
): (scene: VideoScene) => number {
  const { index, time } = typeof at === "number" ? insertBoundaryAt(layout, at) : at;
  const anchor = layout[index]?.itemId ?? null;
  return (scene) => {
    const current = toLayout(scene.items);
    if (anchor === null) return current.length === 0 ? 0 : current[current.length - 1].timelineEnd;
    return current.find((entry) => entry.itemId === anchor)?.timelineStart ?? time;
  };
}

/** How long a screenshot added to the sequence is shown (the spec's decision 8; floating is 10 s). */
export const SEQUENCE_IMAGE_SECONDS = 5;

/**
 * The scene with `slide` inserted at the boundary `resolve` names for it (an `anchoredBoundary`
 * result: a timeline time). The index is read from the scene given, not from the one the
 * boundary was chosen on, because the image is decoded asynchronously and the sequence may have
 * changed meanwhile. Boundary times are unique (items last at least `MIN_ITEM_DURATION`), so
 * `boundaryIndexAt` finds that boundary exactly, and `layout[i]` is `items[i]` because
 * `toLayout` skips only zero-length items, which the editor never keeps.
 */
export function insertSlideAtBoundary(
  scene: VideoScene,
  slide: SlideItem,
  resolve: (scene: VideoScene) => number,
): VideoScene {
  const index = boundaryIndexAt(toLayout(scene.items), resolve(scene));
  return { ...scene, items: insertItemAt(scene.items, index, slide) };
}

/** The two kinds of Library item the modal adds. */
export type LibraryItemKind = "recording" | "screenshot";

/** Where a Library item can go (NIW2-829): over the video, or at one of four sequence boundaries. */
export type LibraryDestination = "over" | "before-clip" | "after-clip" | "start" | "end";

/** The destinations in the order the chooser lists them. */
export const LIBRARY_DESTINATIONS: readonly LibraryDestination[] = [
  "over",
  "before-clip",
  "after-clip",
  "start",
  "end",
];

/** What each kind of item selects before the user touches the chooser. */
export function defaultDestination(kind: LibraryItemKind): LibraryDestination {
  return kind === "screenshot" ? "over" : "after-clip";
}

/** A recording cannot float over the video yet (floating videos are a later stage). */
export function destinationAllowed(
  kind: LibraryItemKind,
  destination: LibraryDestination,
): boolean {
  return !(kind === "recording" && destination === "over");
}

/**
 * The sequence boundary a destination means for the sequence and playhead as they are now; null
 * for "over", which has no boundary because it never touches the sequence.
 */
export function boundaryForDestination(
  destination: LibraryDestination,
  layout: LayoutEntry[],
  playhead: number,
): { index: number; time: number } | null {
  switch (destination) {
    case "over":
      return null;
    case "before-clip":
      return boundaryBeforeClipAt(layout, playhead);
    case "after-clip":
      return boundaryAfterClipAt(layout, playhead);
    case "start":
      return boundaryAtStart();
    case "end":
      return boundaryAtEnd(layout);
  }
}
