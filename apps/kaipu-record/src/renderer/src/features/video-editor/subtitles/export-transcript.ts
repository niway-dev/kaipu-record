import type { SaveTextExtension } from "@shared/types/save-text-file";
import type { WordOccurrence } from "../transcript-occurrence";
import { groupParagraphs } from "../transcript-paragraphs";
import { buildCues } from "./cues";
import { formatSrt } from "./srt";
import { formatTxt } from "./txt";
import { formatVtt } from "./vtt";

export type TranscriptExportFormat = SaveTextExtension;

/**
 * The text of an exported transcript file (NIW2-818 M3). The input is exactly what the
 * Transcript panel shows: the projection's `WordOccurrence`s for the EDITED video (cuts removed,
 * muted words absent, speed handled by the projection), so the file cannot disagree with the
 * panel. Times are edited-timeline seconds, which is what an exported MP4 plays.
 *
 * - `srt` and `vtt`: `buildCues` then `formatSrt` (comma milliseconds) or `formatVtt` (`WEBVTT`
 *   header, dot milliseconds). A cue never spans a timeline discontinuity (a cut inside a
 *   sentence splits it).
 * - `txt`: the panel's paragraphs, through `formatTxt`.
 *
 * Unresolved intervals (stretches the engine could not recognise) are NOT written: they carry
 * no words, and a "[not recognised]" marker in a subtitle file would show on screen. The panel
 * marks them for the reader; the exports skip them.
 *
 * The caller writes the string as UTF-8. Nothing to export gives an empty string.
 */
export function buildTranscriptExport(
  occurrences: readonly WordOccurrence[],
  format: TranscriptExportFormat,
): string {
  switch (format) {
    case "srt":
      return formatSrt(buildCues(occurrences));
    case "vtt":
      return formatVtt(buildCues(occurrences));
    case "txt":
      return formatTxt(groupParagraphs(occurrences));
  }
}
