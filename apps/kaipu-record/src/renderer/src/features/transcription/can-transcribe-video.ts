import type { LibraryVideo } from "@renderer/features/library/types";

/**
 * Whether a Library item has audio worth transcribing: a local recording, not a screenshot, a GIF
 * export or a cloud-only item, and not one known to have no audio track (`hasAudio` is `undefined`
 * when the host has not read the file). The Transcribe button uses this rule alone; the detail
 * page's Transcript tab also needs a known or pending duration, so the tab can be absent where the
 * button shows.
 */
export function canTranscribeVideo(
  video: Pick<LibraryVideo, "kind" | "id">,
  hasAudio?: boolean,
): boolean {
  return video.kind === "recording" && video.id !== null && hasAudio !== false;
}
