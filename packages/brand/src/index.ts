/**
 * The Kaipu logo system.
 *
 * One mark cannot do every job, so there are four, and the rule is about what
 * the viewer already knows:
 *
 *   - Somewhere Kaipu has to explain itself — the Dock, ⌘-Tab, Finder, the DMG,
 *     a marketing image — the mark carries the frame corners AND the record dot,
 *     so the icon alone says "screen capture and recording" without a generic
 *     camera glyph.
 *   - Somewhere it is already obvious you are inside Kaipu — the desktop
 *     sidebar, a navbar, the web app — none of that is needed. The fox alone is
 *     more recognisable at that size, and the corners just add noise.
 *   - Below about 32px the corners stop being legible at all: they render as a
 *     grey fringe. Small sizes get the fox alone too.
 *   - The menu bar is monochrome by platform convention, and there the mark
 *     changes with state rather than staying still.
 *
 * Callers pick a PURPOSE, not an artwork, so the rule lives here rather than in
 * each caller's head.
 */

import logoApp from "../assets/logo-app.png";
import logoPlain from "../assets/logo-plain.png";
import logoRecord from "../assets/logo-record.png";
import logoScreenshot from "../assets/logo-screenshot.png";

export const LOGO_USES = [
  /** Dock, ⌘-Tab, Finder, the DMG, installers, large marketing art. */
  "app",
  /** Inside Kaipu: desktop sidebar, navbars, the web app. */
  "product",
  /** Favicon, tabs, anything at 16–32px. */
  "micro",
  /** State marks — a recording in progress, a capture. */
  "record",
  "screenshot",
] as const;

export type LogoUse = (typeof LOGO_USES)[number];

/**
 * Artwork per purpose. `micro` deliberately resolves to the plain fox: the
 * cropped-head cut the system calls for does not exist yet, and the fox alone
 * survives 16px far better than the framed version would.
 */
export const LOGO_SRC: Record<LogoUse, string> = {
  app: logoApp,
  product: logoPlain,
  micro: logoPlain,
  record: logoRecord,
  screenshot: logoScreenshot,
};

export { KaipuLogo } from "./logo";
