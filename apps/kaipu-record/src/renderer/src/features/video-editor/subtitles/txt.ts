import type { WordOccurrence } from "../transcript-occurrence";

/** Structural input: the paragraph grouping is built by the transcript projection. */
export interface TxtParagraph {
  occurrences: readonly WordOccurrence[];
}

/**
 * Plain text: one paragraph per input item, its words joined with single spaces, paragraphs
 * separated by one blank line, a trailing newline. Whitespace inside a word is normalized and
 * empty words and paragraphs are dropped. No paragraphs gives an empty string. The caller writes
 * the string as UTF-8.
 */
export function formatTxt(paragraphs: readonly TxtParagraph[]): string {
  const texts = paragraphs
    .map((paragraph) =>
      paragraph.occurrences
        .map((o) => o.text.replace(/\s+/g, " ").trim())
        .filter((text) => text !== "")
        .join(" "),
    )
    .filter((text) => text !== "");
  return texts.length === 0 ? "" : `${texts.join("\n\n")}\n`;
}
