/**
 * Title of a fresh screenshot, stamped at capture time (mirrors recordings'
 * "Recording — <date>") so saved shots are told apart by when they were taken.
 * Shared by the editor path (renderer) and the quiet path (main) so both match.
 */
export function screenshotTitle(date: Date = new Date()): string {
  return `Screenshot — ${date.toLocaleString()}`;
}
