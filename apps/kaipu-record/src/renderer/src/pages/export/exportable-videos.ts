import { isMaster } from "@renderer/features/library/lineage";
import type { LibraryVideo } from "@renderer/features/library/types";
import { asPreparable } from "@renderer/features/prepare/use-prepare-copy";

/** The Library's originals a copy can be exported from, newest first. */
export function exportableVideos(videos: readonly LibraryVideo[]): LibraryVideo[] {
  return videos
    .filter((v) => asPreparable(v) !== null && isMaster(v))
    .sort((a, b) => b.createdAt - a.createdAt);
}
