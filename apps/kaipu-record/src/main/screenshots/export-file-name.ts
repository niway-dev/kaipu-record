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
export const EXPORT_EXTENSIONS = ["pdf", "png", "jpg", "webp"] as const;
export type ExportExtension = (typeof EXPORT_EXTENSIONS)[number];

/** The `dialogs.*` message that names each format in the save dialog's file-type filter. */
export const EXPORT_FILE_TYPE_KEYS = {
  pdf: "pdfFileType",
  png: "pngFileType",
  jpg: "jpegFileType",
  webp: "webpFileType",
} as const satisfies Record<ExportExtension, string>;

/** True when `bytes` holds `signature` starting at offset `at`. */
function startsWith(bytes: Uint8Array, signature: readonly number[], at = 0): boolean {
  return signature.every((b, i) => bytes[at + i] === b);
}

/**
 * What each format's file starts with. The extension is only a name; the bytes have to be that
 * format, or a renderer bug (an encoder that fell back to PNG) would write a ".webp" that is not
 * one. A WebP is `RIFF`, a 4-byte size, then `WEBP`.
 */
const SIGNATURES: Record<ExportExtension, (bytes: Uint8Array) => boolean> = {
  pdf: (b) => startsWith(b, [0x25, 0x50, 0x44, 0x46]),
  png: (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  jpg: (b) => startsWith(b, [0xff, 0xd8, 0xff]),
  webp: (b) =>
    startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x45, 0x42, 0x50], 8),
};

/**
 * Upper bound for one exported file. A 3× raster of the largest capture the
 * compositor allows stays well under this; anything bigger is not an export.
 */
export const MAX_EXPORT_BYTES = 256 * 1024 * 1024;

/**
 * Validate what the renderer sent before main opens a dialog or touches disk:
 * real bytes, within the cap, in a format on the allowlist, and bytes that really are that
 * format. Throws otherwise.
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
  if (!SIGNATURES[extension as ExportExtension](new Uint8Array(bytes))) {
    throw new Error(`export: bytes are not a ${String(extension)} file`);
  }
}
