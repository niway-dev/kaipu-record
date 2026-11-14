import type { LibraryVideo } from "@renderer/features/library/types";
import { MIN_ITEM_DURATION } from "./timeline";

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
