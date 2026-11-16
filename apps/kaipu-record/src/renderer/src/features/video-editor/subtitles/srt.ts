import type { Cue } from "./cues";
import { formatTimestamp } from "./timestamp";

/**
 * SubRip text: per cue an index line, `HH:MM:SS,mmm --> HH:MM:SS,mmm`, the text lines and a blank
 * line. `\n` line endings, a trailing newline, no cues gives an empty string. The caller writes
 * the string as UTF-8.
 */
export function formatSrt(cues: readonly Cue[]): string {
  return cues
    .map(
      (cue) =>
        `${cue.index}\n${formatTimestamp(cue.start, ",")} --> ${formatTimestamp(cue.end, ",")}\n${cue.lines.join("\n")}\n`,
    )
    .join("\n");
}
