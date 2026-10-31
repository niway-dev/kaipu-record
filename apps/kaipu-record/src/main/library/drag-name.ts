import { fileStemFromTitle } from "./file-stem";

const FALLBACK_BASE = "Kaipu export";

/**
 * NIW2-218: the file name a dragged vault item carries — the item's title, made safe for any
 * drop target, plus the vault file's extension (`ext` includes the dot, e.g. ".mp4").
 * NIW2-560: the same projection the vault uses for its own file names, so a dragged file and
 * the file in the folder usually carry the same name.
 */
export function friendlyDragName(name: string, ext: string): string {
  return `${fileStemFromTitle(name) ?? FALLBACK_BASE}${ext}`;
}
