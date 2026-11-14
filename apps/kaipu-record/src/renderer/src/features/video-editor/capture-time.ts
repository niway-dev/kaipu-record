/** "0:09.0": minutes, seconds and tenths, so a 5 s skip or a captured frame is visible. */
export function formatClock(seconds: number): string {
  const tenths = Math.max(0, Math.floor(seconds * 10 + 1e-6));
  const m = Math.floor(tenths / 600);
  const s = Math.floor((tenths % 600) / 10);
  return `${m}:${String(s).padStart(2, "0")}.${tenths % 10}`;
}

/**
 * The time in a frame capture's title ("1m23s"). No colon or dot: the title becomes the
 * file name (ADR 0035) and `:` is forbidden on Windows and macOS.
 */
export function captureTitleTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds + 1e-6));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const two = (n: number): string => String(n).padStart(2, "0");
  if (h > 0) return `${h}h${two(m)}m${two(s)}s`;
  if (m > 0) return `${m}m${two(s)}s`;
  return `${s}s`;
}

/**
 * The existing capture taken at `sourceSeconds`, compared at millisecond precision (the
 * resolution a stored link keeps), or undefined. A slide frame has no source second
 * (`null`), so it never matches: two slide captures are not the same frame.
 */
export function findCaptureAt<T extends { sourceTimeSeconds: number | null }>(
  captures: readonly T[],
  sourceSeconds: number | null,
): T | undefined {
  if (sourceSeconds === null) return undefined;
  const ms = Math.round(sourceSeconds * 1000);
  return captures.find(
    (capture) =>
      capture.sourceTimeSeconds !== null && Math.round(capture.sourceTimeSeconds * 1000) === ms,
  );
}
