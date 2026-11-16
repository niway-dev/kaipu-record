/**
 * `HH:MM:SS<separator>mmm` for a time in seconds, shared by SRT (comma) and WebVTT (dot).
 * Milliseconds are rounded, not truncated, and the carry is applied after rounding, so 0.9995 s
 * is `00:00:01,000`, never `00:00:00,1000`. Hours grow past two digits only as the number does.
 * A negative or non-finite time is 0.
 */
export function formatTimestamp(seconds: number, separator: "," | "."): string {
  const totalMs = Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : 0;
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const secs = Math.floor((totalMs % 60_000) / 1000);
  const ms = totalMs % 1000;
  const pad = (n: number, width: number) => String(n).padStart(width, "0");
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(secs, 2)}${separator}${pad(ms, 3)}`;
}
