import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The directory of the test file whose `import.meta.url` is `metaUrl`. `fileURLToPath`, not
 * `new URL(...).pathname`: the latter keeps `%20` for a checkout under a folder with a space,
 * and keeps a leading `/C:/` on Windows, so a scan of the source tree reads the wrong place.
 */
export function dirnameOf(metaUrl: string): string {
  return path.dirname(fileURLToPath(metaUrl));
}

/** `path.relative`, spelled with forward slashes so it compares with ids written in source. */
export function relativeId(from: string, to: string): string {
  return path.relative(from, to).split(path.sep).join("/");
}
