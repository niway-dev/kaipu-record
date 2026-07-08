import type { LocalRecording } from "@shared/types";
import type { LibraryVideo } from "@renderer/features/library/types";

/** Maps a vault recording (main-process shape) to the library UI's view model. */
export function toLibraryVideo(recording: LocalRecording): LibraryVideo {
  return {
    id: recording.id,
    kind: recording.kind,
    title: recording.title,
    createdAt: recording.createdAt,
    durationSeconds: recording.durationSeconds,
    fileSizeBytes: recording.sizeBytes,
    thumbnailUrl: recording.thumbnailUrl ?? null,
    storage: "local",
  };
}
