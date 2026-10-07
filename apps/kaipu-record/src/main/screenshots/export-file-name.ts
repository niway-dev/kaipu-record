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
