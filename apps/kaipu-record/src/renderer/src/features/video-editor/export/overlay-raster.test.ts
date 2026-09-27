import { describe, expect, it } from "vitest";
import { overlaySvg } from "./overlay-raster";
import type { VideoOverlay } from "@renderer/features/video-editor/scene";

/**
 * A line break that survives editing, is drawn in the preview, and then silently
 * collapses in the exported video is the worst of the three failures: the user only
 * finds out after the export. SVG `<text>` does not wrap or honour newlines, so each
 * line has to be its own `<tspan>` — exactly what the screenshot compositor does.
 */
// No cast: the real type is what guards this fixture, and it already caught two
// invented field names here.
function label(text: string): VideoOverlay {
  return {
    id: "o1",
    kind: "text",
    x: 0.25,
    y: 0.5,
    text,
    color: "#ff0000",
    size: 1,
    start: 0,
    end: 1,
  };
}

describe("overlaySvg, for a text overlay", () => {
  it("emits one tspan per line", () => {
    const svg = overlaySvg(label("first\nsecond"), 1920, 1080, 1);
    expect(svg.match(/<tspan/g)).toHaveLength(2);
    expect(svg).toContain(">first<");
    expect(svg).toContain(">second<");
  });

  it("offsets every line after the first, so they do not overprint", () => {
    const svg = overlaySvg(label("a\nb"), 1920, 1080, 1);
    const dys = [...svg.matchAll(/dy="([^"]+)"/g)].map((m) => Number(m[1]));
    expect(dys[0]).toBe(0);
    expect(dys[1]).toBeGreaterThan(0);
  });

  it("still escapes markup, per line", () => {
    const svg = overlaySvg(label("<b>\n&amp"), 1920, 1080, 1);
    expect(svg).toContain("&lt;b&gt;");
    expect(svg).not.toMatch(/<b>/);
  });

  it("renders a single line as one tspan, unchanged in position", () => {
    const svg = overlaySvg(label("solo"), 1920, 1080, 1);
    expect(svg.match(/<tspan/g)).toHaveLength(1);
    expect(svg).toContain(">solo<");
  });
});
