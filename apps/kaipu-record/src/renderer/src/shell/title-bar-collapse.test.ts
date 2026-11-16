import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { dirnameOf } from "../test/source-tree";

/**
 * A crowded title bar degrades instead of overflowing (NIW2-619 review S1). With a page's
 * actions in the bar (the video editor's), the lower-priority pieces collapse first as
 * the window narrows toward its 720 px minimum, and Export never leaves the window.
 *
 * jsdom has no layout, so this reads the stylesheet; the harness shots at 1024 and 720 px
 * are the visual proof.
 */
const dir = dirnameOf(import.meta.url);
const css = readFileSync(path.join(dir, "title-bar.module.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);
const toolbarCss = readFileSync(
  path.join(dir, "../features/video-editor/components/editor-toolbar.module.css"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

/** The max-width of the `@container titlebar` block that hides `selector`, or null. */
function breakpointOf(selector: string): number | null {
  const blocks = css.matchAll(/@container titlebar \(max-width:\s*(\d+)px\)\s*\{([\s\S]*?)\n\}/g);
  for (const [, width, body] of blocks) {
    if (body!.includes(selector) && /display:\s*none/.test(body!)) return Number(width);
  }
  return null;
}

describe("title bar collapse order", () => {
  it("is a size container the pieces query", () => {
    expect(css).toMatch(/container:\s*titlebar\s*\/\s*inline-size/);
  });

  it("collapses the badge, then the Transcribe word, then the location, then the save state, then the app name, then the chip's name", () => {
    const order = [
      '[data-collapse~="badge"]',
      '[data-collapse~="transcribe-label"]',
      '[data-collapse~="location"]',
      '[data-collapse~="save"]',
      ".name",
      '[data-collapse~="chip-name"]',
    ].map(breakpointOf);
    for (const width of order) expect(width).not.toBeNull();
    // Wider breakpoint = collapses earlier.
    const sorted = [...order].sort((a, b) => b! - a!);
    expect(order).toEqual(sorted);
    // Everything that can go has gone by the 720 px window minimum.
    expect(Math.min(...(order as number[]))).toBeGreaterThan(720);
  });

  it("only collapses while a page's actions are in the bar", () => {
    expect(css).toMatch(/\.bar:has\(\.actions:not\(:empty\)\)\s*\[data-collapse~="badge"\]/);
  });

  it("lets the actions shrink, and never Export", () => {
    expect(css).toMatch(/\.actions\s*\{[^}]*min-width:\s*0/);
    expect(toolbarCss).toMatch(/\.exportBtn\s*\{[^}]*flex-shrink:\s*0/);
  });
});
