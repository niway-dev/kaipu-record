import type { Cue } from "./cues";
import { formatTimestamp } from "./timestamp";

/** WebVTT treats `&`, `<` and `>` in cue text as markup; `&` goes first so it is not doubled. */
function escapeCueText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * WebVTT text: a `WEBVTT` header and a blank line, then per cue `HH:MM:SS.mmm --> HH:MM:SS.mmm`,
 * the escaped text lines and a blank line. No cue identifiers. `\n` line endings; no cues gives
 * only the header. The caller writes the string as UTF-8.
 */
export function formatVtt(cues: readonly Cue[]): string {
  const blocks = cues.map(
    (cue) =>
      `${formatTimestamp(cue.start, ".")} --> ${formatTimestamp(cue.end, ".")}\n${cue.lines.map(escapeCueText).join("\n")}\n`,
  );
  return `WEBVTT\n\n${blocks.join("\n")}`;
}
