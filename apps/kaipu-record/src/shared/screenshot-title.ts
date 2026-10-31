import { defaultCaptureName } from "./default-capture-name";

/**
 * Title of a fresh screenshot, stamped at capture time: "Kaipu Screenshot 2026-10-29 at
 * 13.51.00" (NIW2-560). The vault names the file after it, so the title and the file read
 * the same. Shared by the editor path (renderer) and the quiet path (main) so both match.
 */
export function screenshotTitle(date: Date = new Date()): string {
  return defaultCaptureName("screenshot", date);
}
