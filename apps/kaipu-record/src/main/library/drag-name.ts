/** Characters no common file system accepts in a name, plus control characters. */
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = /[/\\:*?"<>|\u0000-\u001f\u007f]/g;
const MAX_BASE_LENGTH = 180;
const FALLBACK_BASE = "Kaipu export";

function trimEdges(value: string): string {
  return value.replace(/^[\s.]+|[\s.]+$/g, "");
}

/**
 * NIW2-218: the file name a dragged vault item carries — the item's title, made safe for any
 * drop target, plus the vault file's extension (`ext` includes the dot, e.g. ".mp4").
 */
export function friendlyDragName(name: string, ext: string): string {
  const cleaned = trimEdges(name.replace(UNSAFE_CHARS, "-").replace(/\s+/g, " "));
  // Cut on code points so a surrogate pair (emoji) is never split in half.
  const capped = trimEdges(Array.from(cleaned).slice(0, MAX_BASE_LENGTH).join(""));
  return `${capped || FALLBACK_BASE}${ext}`;
}
