import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The picture box must stay ratio-exact at ANY container size.
 *
 * `.content` is not merely "the video": every piece of geometry in the editor — the camera
 * box, its scrim, the zoom transform, the privacy regions, the annotation layer — is stored
 * and dragged as a PERCENTAGE of this element. So the element has to *be* the picture. The
 * moment it is wider or taller than the picture, all of that geometry frames a rectangle
 * that is not what the user sees, and `.stage`'s `overflow: hidden` clips the difference.
 *
 * It broke because the two axes were capped against different things. `d491b7d` made the
 * height row-relative (`max-height: min(46vh, 100%)`) but left the width deriving from the
 * viewport (`width: min(64vw, calc(46vh * ratio))`). Below roughly an 850 px window the
 * stage row is shorter than 46vh, so `100%` clamped the height while the width kept its
 * larger viewport figure — the box stopped matching the ratio, and with a 2x zoom applied
 * the bottom of the recorded screen was cut off.
 *
 * These assertions read the real stylesheets. They prove the box is sized from its
 * CONTAINER rather than the viewport; they do not prove what it looks like, because jsdom
 * has no layout engine. The visual proof belongs in the Playwright suite.
 */
const dir = path.dirname(new URL(import.meta.url).pathname);
const stageCss = readFileSync(path.join(dir, "preview-stage.module.css"), "utf8");
const pageCss = readFileSync(
  path.join(dir, "../../../pages/video-editor/video-editor-page.module.css"),
  "utf8",
);

/**
 * The DECLARATIONS of a single top-level rule, e.g. `.content { … }`, with comments
 * stripped — these rules carry long explanations that quote the very units being
 * asserted against, and a comment must never decide whether a test passes.
 */
function rule(css: string, selector: string): string {
  const match = css.match(new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`no rule for ${selector}`);
  return match[1]!.replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("the preview picture box", () => {
  const content = rule(stageCss, ".content");

  it("is sized from its container, never from the viewport", () => {
    // A viewport unit here is the bug: the stage row is shorter than the viewport
    // whenever the timeline lanes grow or the window is short.
    expect(content).not.toMatch(/\d+vh/);
    expect(content).not.toMatch(/\d+vw/);
  });

  it("derives its width from the container height and the frame ratio", () => {
    // Both axes must bind against the SAME box for the result to keep the ratio.
    expect(content).toMatch(/cqh\s*\*\s*var\(--frame-ratio\)/);
    expect(content).toMatch(/cqw/);
  });

  it("caps its height on the container, so the picture always fits", () => {
    expect(content).toMatch(/max-height:[^;]*cqh/);
  });

  it("has a container to measure: the video region establishes one", () => {
    // Container query units resolve against the nearest ancestor with `container-type`.
    // Without this the cq units silently fall back to the small viewport — the same bug
    // with a different spelling.
    expect(rule(pageCss, ".videoRegion")).toMatch(/container-type:\s*size/);
  });

  it("keeps viewport units for fullscreen, where the viewport IS the container", () => {
    expect(rule(stageCss, ".contentExpanded")).toMatch(/vh|vw/);
  });
});
