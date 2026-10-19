/**
 * Turn a capture title into something a save dialog can seed. Titles carry a
 * locale date ("Screenshot — 10/7/2026, 3:04:05 PM"): the slashes would read as
 * path separators and the colons are illegal on macOS Finder / Windows, so every
 * reserved character becomes a dash. Pure; exported for tests.
 */
export function exportFileName(title: string, extension: string): string {
  const base = title
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "");
  return `${base || "screenshot"}.${extension}`;
}

/** Formats the export IPC writes. The renderer names the format; main decides what is allowed. */
export const EXPORT_EXTENSIONS = ["pdf"] as const;
export type ExportExtension = (typeof EXPORT_EXTENSIONS)[number];

/**
 * Upper bound for one exported file. A 3× raster of the largest capture the
 * compositor allows stays well under this; anything bigger is not an export.
 */
export const MAX_EXPORT_BYTES = 256 * 1024 * 1024;

/**
 * Validate what the renderer sent before main opens a dialog or touches disk:
 * real bytes, within the cap, in a format on the allowlist. Throws otherwise.
 * Pure; exported for tests.
 */
export function assertExportPayload(
  bytes: unknown,
  extension: unknown,
): asserts bytes is ArrayBuffer {
  if (!(bytes instanceof ArrayBuffer)) throw new Error("export: bytes must be an ArrayBuffer");
  if (bytes.byteLength === 0) throw new Error("export: bytes are empty");
  if (bytes.byteLength > MAX_EXPORT_BYTES) {
    throw new Error(`export: ${bytes.byteLength} bytes exceeds the ${MAX_EXPORT_BYTES} cap`);
  }
  if (!EXPORT_EXTENSIONS.includes(extension as ExportExtension)) {
    throw new Error(`export: format "${String(extension)}" is not allowed`);
  }
}
