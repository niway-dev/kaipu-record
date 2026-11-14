import type { LibraryVideo } from "@renderer/features/library/types";
import type { VideoScene } from "./scene";
import { boundaryIndexAt, MIN_ITEM_DURATION, toLayout, type LayoutEntry } from "./timeline";

/**
 * The recordings the Add recording panel offers (NIW2-782): the Library's own recordings, other
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
 * The boundary `t` names on `layout`, pinned to the clip that FOLLOWS it (null: the end of the
 * sequence), as a function of the scene a join composes from. A join waits behind earlier ones,
 * and one that inserted a clip ahead of the boundary moves it: the anchor moves with it, so the
 * recording lands where the user dropped it. Following the clip, and the end, keeps two quick
 * adds at the end in the order they were made. If the anchor clip was removed meanwhile, the
 * original boundary time stands. The scene's layout is `joinRecording`'s own (`toLayout`).
 */
export function anchoredBoundary(layout: LayoutEntry[], t: number): (scene: VideoScene) => number {
  const { index, time } = insertBoundaryAt(layout, t);
  const anchor = layout[index]?.itemId ?? null;
  return (scene) => {
    const current = toLayout(scene.items);
    if (anchor === null) return current.length === 0 ? 0 : current[current.length - 1].timelineEnd;
    return current.find((entry) => entry.itemId === anchor)?.timelineStart ?? time;
  };
}
