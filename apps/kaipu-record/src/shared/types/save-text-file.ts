/**
 * Saving a text file the user picks the place for (NIW2-818 M3: the transcript as SRT, VTT or
 * TXT). Reachable from the preload bundle, so this file imports nothing at runtime.
 */

/** The formats main will write. The renderer names one; main decides what is allowed. */
export const SAVE_TEXT_EXTENSIONS = ["srt", "vtt", "txt"] as const;
export type SaveTextExtension = (typeof SAVE_TEXT_EXTENSIONS)[number];

/** A 3-hour transcript is well under 1 MB of text; this is a sanity cap, not a target. */
export const MAX_SAVE_TEXT_BYTES = 5 * 1024 * 1024;

export interface SaveTextFileRequest {
  /** The file name without extension, usually the video's title. Main sanitizes it. */
  suggestedName: string;
  extension: SaveTextExtension;
  /** Written as UTF-8. */
  text: string;
}

export type SaveTextFileResult =
  | { status: "saved"; path: string }
  | { status: "cancelled" }
  | { status: "failed" };
