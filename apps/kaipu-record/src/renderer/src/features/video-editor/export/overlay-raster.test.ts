import { describe, expect, it } from "vitest";
import { overlaySvg } from "./overlay-raster";
import type { TextOverlay } from "@renderer/features/video-editor/scene";

/**
 * A line break that survives editing, is drawn in the preview, and then silently
 * collapses in the exported video is the worst of the three failures: the user only
 * finds out after the export. SVG `<text>` does not wrap or honour newlines, so each
 * line has to be its own `<tspan>` — exactly what the screenshot compositor does.
 */
// No cast: the real type is what guards this fixture, and it already caught two
// invented field names here.
function label(text: string): TextOverlay {
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

/**
 * The complaint that started the refactor: "cambiar el size del box no afecta el
 * string interno". The width lived nowhere in the video model, so dragging a side
 * wrote a field the renderer ignored and the session dropped. These pin the new
 * contract at the export boundary, where a silent failure is worst.
 */
describe("a text overlay with a width", () => {
  function wide(text: string, width?: number): TextOverlay {
    return { ...label(text), width };
  }

  it("wraps to the width instead of running off the frame", () => {
    const words = "alpha beta gamma delta epsilon";
    const unbounded = overlaySvg(wide(words), 1920, 1080, 1);
    const bounded = overlaySvg(wide(words, 0.1), 1920, 1080, 1);

    expect(unbounded.match(/<tspan/g)).toHaveLength(1);
    expect((bounded.match(/<tspan/g) ?? []).length).toBeGreaterThan(1);
  });

  it("keeps every word — wrapping moves text, it never drops it", () => {
    const words = "alpha beta gamma delta epsilon";
    const bounded = overlaySvg(wide(words, 0.1), 1920, 1080, 1);
    for (const word of words.split(" ")) expect(bounded).toContain(word);
  });

  it("honours a free font size over the preset index", () => {
    const preset = overlaySvg(label("hi"), 1920, 1080, 1);
    const custom = overlaySvg({ ...label("hi"), fontPx: 123 }, 1920, 1080, 1);
    expect(custom).toContain('font-size="123"');
    expect(custom).not.toBe(preset);
  });
});
