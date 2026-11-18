import type { LibraryVideo } from "@renderer/features/library/types";

/**
 * Whether a Library item has audio worth transcribing: a local recording, not a screenshot, a GIF
 * export or a cloud-only item, and not one known to have no audio track (`hasAudio` is `undefined`
 * when the host has not read the file). The Transcribe button and the detail page's Transcript tab
 * share this rule, so where one is missing the other is too.
 */
export function canTranscribeVideo(
  video: Pick<LibraryVideo, "kind" | "id">,
  hasAudio?: boolean,
): boolean {
  return video.kind === "recording" && video.id !== null && hasAudio !== false;
}
