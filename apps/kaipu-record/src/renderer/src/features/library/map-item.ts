import type { LibraryItem } from "@shared/types/library-item";
import type { LibraryVideo } from "./types";

/** Maps a unified library item (main-process shape) to the library UI's view model. */
export function toLibraryVideo(item: LibraryItem): LibraryVideo {
  return {
    id: item.local?.id ?? null,
    assetId: item.assetId,
    kind: item.kind,
    title: item.title,
    createdAt: item.createdAt,
    durationSeconds: item.durationSeconds,
    fileSizeBytes: item.local?.sizeBytes ?? item.cloud?.sizeBytes ?? 0,
    cloudSizeBytes: item.cloud?.sizeBytes ?? null,
    thumbnailUrl: item.local?.thumbnailUrl ?? null,
    availability: item.availability,
    comparison: item.comparison,
    editing: item.editing,
    transfer: item.transfer,
    derivedFromAssetId: item.derivedFromAssetId,
    editSavedAt: item.editSavedAt,
    editExportedSavedAt: item.editExportedSavedAt,
    tags: item.local?.tags ?? [],
  };
}
