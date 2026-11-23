import type { LibraryVideo } from "@renderer/features/library/types";

/**
 * Whether a Library item has audio worth transcribing: a local recording, not a screenshot, a GIF
 * export or a cloud-only item, and not one known to have no audio track (`hasAudio` is `undefined`
 * when the host has not read the file), and whose media a sync provider has not offloaded (main
 * refuses to read it, because reading would download it, so a job could only fail). The
 * Transcribe button uses this rule alone; the detail page's Transcript tab also needs a known or
 * pending duration, so the tab can be absent where the button shows.
 */
export function canTranscribeVideo(
  video: Pick<LibraryVideo, "kind" | "id"> & { evicted?: LibraryVideo["evicted"] },
  hasAudio?: boolean,
): boolean {
  return (
    video.kind === "recording" &&
    video.id !== null &&
    hasAudio !== false &&
    video.evicted !== "media"
  );
}
