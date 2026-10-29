/**
 * Default names for new captures (NIW2-560, ADR 0032). The same string is the item's
 * title and the stem the vault derives its file name from, so the folder reads well
 * before anyone renames anything.
 *
 * Shared by the renderer (a recording's title is set there) and main (the quiet
 * screenshot path, stranded recovery). No value imports from workspace packages: this
 * directory is reachable from the preload bundle (see CLAUDE.md).
 */
export type CaptureKind = "recording" | "screenshot" | "gif";

const KIND_LABEL: Record<CaptureKind, string> = {
  recording: "Recording",
  screenshot: "Screenshot",
  gif: "GIF",
};

const pad = (value: number): string => String(value).padStart(2, "0");

/**
 * "Kaipu Recording 2026-10-29 at 13.51.00" — local time, 24-hour, second resolution.
 * Dots between the time fields because `:` is forbidden in Windows file names, and dots
 * are what macOS uses in its own capture names.
 */
export function defaultCaptureName(kind: CaptureKind, date: Date = new Date()): string {
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}.${pad(date.getMinutes())}.${pad(date.getSeconds())}`;
  return `Kaipu ${KIND_LABEL[kind]} ${day} at ${time}`;
}
