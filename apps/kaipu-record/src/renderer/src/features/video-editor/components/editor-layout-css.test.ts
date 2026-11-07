import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Kaipu Black editor layout (NIW2-619): the exact lane heights, the gap between lanes,
 * the rail width and where the picture sits. jsdom has no layout engine, so these read
 * the real stylesheets; the harness screenshots are the visual proof.
 */
const dir = path.dirname(new URL(import.meta.url).pathname);
const css = (file: string): string => readFileSync(path.join(dir, file), "utf8");

/** Declarations of one top-level rule, comments stripped (they quote old values). */
function rule(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`no rule for ${selector}`);
  return match[1]!.replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("timeline lanes (15% lower than NIW2-611)", () => {
  it.each([
    ["zoom-lane.module.css", ".lane", "26px"],
    ["privacy-lane.module.css", ".lane", "20px"],
    ["audio-lane.module.css", ".lane", "29px"],
    ["timeline-strip.module.css", ".track", "46px"],
  ])("%s %s is %s tall", (file, selector, height) => {
    expect(rule(css(file), selector)).toMatch(new RegExp(`(?:^|[\\s;])height:\\s*${height};`));
  });

  it("leaves 3px between lanes", () => {
    expect(rule(css("timeline-strip.module.css"), ".timelineBody")).toMatch(/row-gap:\s*3px;/);
  });
});

describe("the sticky lane label's fills (NIW2-667)", () => {
  // The label is sticky: once the timeline scrolls, lanes slide under it. Its box covers
  // only the label column, so what sits BETWEEN the label and the lane (the column gap, and
  // the corner where that gap meets the 3px row gap) has to be filled by its shadow, or the
  // content scrolled past the lane's left edge (blocks, thumbnails, the playhead) shows
  // through there. A shadow, not padding or a pseudo-element: the label clips its own text
  // with overflow:hidden, which would clip both of those but not its own shadow.
  //
  // Only while the content IS scrolled (R2-2). At scroll 0 the gap holds things that belong
  // there: the start handle of a clip at t=0 sits 4 px into it and the playhead's head at t=0
  // 5 px, and a shadow painted over the gap (the label is above both) cut them in half.
  // TimelineStrip sets data-scrolled on the scroll container; the fills hang on it.
  const SCROLLED = '.timelineBody[data-scrolled="true"] .laneLabel';
  const shadow = (selector: string): string => {
    const declarations = rule(css("timeline-strip.module.css"), selector);
    return declarations.match(/box-shadow:([^;]*);/)![1]!;
  };

  it("fills the column gap to the lane, in the panel colour, once the content is scrolled", () => {
    expect(shadow(SCROLLED)).toMatch(/(?:^|,)\s*var\(--lane-gap\)\s+0\s+0\s+0\s+var\(--bg-panel\)/);
  });

  it("fills the corner where the column gap meets the row gap, once the content is scrolled", () => {
    expect(shadow(SCROLLED)).toMatch(
      /(?:^|,)\s*var\(--lane-gap\)\s+3px\s+0\s+0\s+var\(--bg-panel\)/,
    );
  });

  it("keeps the row-gap fill in the scrolled rule too: its list replaces the base one whole", () => {
    expect(shadow(SCROLLED)).toMatch(/(?:^|,)\s*0\s+3px\s+0\s+0\s+var\(--bg-panel\)/);
  });

  it("paints nothing over the gap at scroll 0: the base rule fills only the row gap under the label", () => {
    expect(shadow(".laneLabel").trim()).toBe("0 3px 0 0 var(--bg-panel)");
    expect(shadow(".laneLabel")).not.toMatch(/--lane-gap/);
  });

  it("is opaque and above the lanes and the playhead layer", () => {
    const declarations = rule(css("timeline-strip.module.css"), ".laneLabel");
    expect(declarations).toMatch(/background:\s*var\(--bg-panel\)/);
    const z = (selector: string): number =>
      Number(rule(css("timeline-strip.module.css"), selector).match(/z-index:\s*(\d+)/)![1]);
    expect(z(".laneLabel")).toBeGreaterThan(z(".playheadLayer"));
  });
});

describe("tool rail and picture", () => {
  it("the rail is 44px wide", () => {
    expect(rule(css("editor-toolbar.module.css"), ".rail")).toMatch(/(?:^|\s)width:\s*44px;/);
  });

  it("the tool flyout uses the panel surface, a strong 1px line, a 6px radius and the popover shadow", () => {
    const flyout = rule(css("editor-toolbar.module.css"), ".flyout");
    expect(flyout).toMatch(/background:\s*var\(--bg-panel\)/);
    expect(flyout).toMatch(/border:\s*1px solid var\(--line-strong\)/);
    expect(flyout).toMatch(/border-radius:\s*6px/);
    expect(flyout).toMatch(/box-shadow:\s*var\(--shadow-popover\)/);
  });

  it("the current flyout option takes the accent colour", () => {
    expect(rule(css("editor-toolbar.module.css"), ".flyoutCurrent")).toMatch(
      /color:\s*var\(--accent-primary\)/,
    );
  });

  it("nothing paints a hover fill in a corner of a rail button", () => {
    const toolbar = css("editor-toolbar.module.css");
    expect(toolbar).not.toMatch(/variantSwitch/);
  });

  it("the picture is centred with a 12px margin", () => {
    const region = rule(
      css("../../../pages/video-editor/video-editor-page.module.css"),
      ".videoRegion",
    );
    expect(region).toMatch(/justify-items:\s*center;/);
    expect(region).toMatch(/padding:\s*12px;/);
  });
});

describe("timeline zoom layout (NIW2-667)", () => {
  const strip = css("timeline-strip.module.css");
  /** The formatter wraps long declarations: compare them with their whitespace collapsed. */
  const flat = (declarations: string): string => declarations.replace(/\s+/g, " ");
  const body = flat(rule(strip, ".timelineBody"));

  it("scrolls horizontally in one container and sizes the lanes column by --zoom", () => {
    expect(body).toMatch(/overflow-x: auto;/);
    expect(body).toMatch(
      /grid-template-columns: var\(--lane-label-w\) calc\( ?\(100% - var\(--lane-label-w\) - var\(--lane-gap\)\) \* var\(--zoom, 1\) ?\);/,
    );
    expect(body).toMatch(/column-gap: var\(--lane-gap\);/);
  });

  it("at fit the lanes column is what 1fr was: the same width, in the same place", () => {
    // 1fr = content box - label - gap; the formula at --zoom 1 is the same expression.
    expect(body).toMatch(/--lane-label-w: 112px;/);
    expect(body).toMatch(/--lane-gap: var\(--space-sm\);/);
  });

  it("the playhead layer is as wide as the lanes column, so it cannot drift from the ruler", () => {
    // The grid's `100%` is the content box (the padding box less the trailing room); the
    // layer's is the padding box. Taking that room off the layer's side makes both the same
    // width at every zoom.
    expect(body).toMatch(/padding-right: var\(--lane-end\);/);
    const layer = flat(rule(strip, ".playheadLayer"));
    expect(layer).toMatch(
      /width: calc\( ?\(100% - var\(--lane-label-w\) - var\(--lane-gap\) - var\(--lane-end\)\) \* var\(--zoom, 1\) ?\);/,
    );
    expect(layer).toMatch(/left: calc\(var\(--lane-label-w\) \+ var\(--lane-gap\)\);/);
  });

  it("the labels stay put and cover their whole row, including the 3px between rows", () => {
    const label = flat(rule(strip, ".laneLabel"));
    expect(label).toMatch(/position: sticky;/);
    expect(label).toMatch(/left: 0;/);
    expect(label).toMatch(/align-self: stretch;/);
    expect(label).toMatch(/box-shadow: 0 3px 0 0 var\(--bg-panel\)[,;]/); // first of the fills
    expect(label).toMatch(/background: var\(--bg-panel\);/);
  });

  it("scrolls in x only: overflow-y is clipped, so no vertical scrollbar can take width from the lanes", () => {
    // `overflow-x: auto` alone makes overflow-y compute to `auto`, and a classic vertical
    // scrollbar (Windows, Linux, macOS set to "always show") would narrow the content box
    // while the strip measures the lane from the border box: every pointer-to-time
    // conversion would then be off by the scrollbar's width. The region is content-sized
    // (see `.timeline` in the page), so there is never a vertical scroll to lose.
    expect(body).toMatch(/overflow-x: auto;/);
    expect(body).toMatch(/overflow-y: clip;/);
  });

  it("leaves room after the last lane for the end handle, taken from the strip's own padding", () => {
    expect(body).toMatch(/--lane-end: 8px;/);
    expect(body).toMatch(/margin-right: calc\(-1 \* var\(--lane-end\)\);/);
    // The room must come out of padding the strip really has.
    expect(rule(strip, ".strip")).toMatch(/padding: var\(--space-sm\) var\(--space-lg\)/);
  });

  it("gives a fit timeline its old height: the scrollbar's strip is taken back by a negative margin", () => {
    expect(body).toMatch(/--lane-bottom: 8px;/);
    expect(body).toMatch(/padding-bottom: var\(--lane-bottom\);/);
    expect(body).toMatch(/margin-bottom: calc\(-1 \* var\(--lane-bottom\)\);/);
  });

  it("stops the playhead at the last lane: it does not cross the scrollbar's strip", () => {
    // `.playheadLayer` is positioned against the padding box, so `bottom: 0` would run it
    // through the strip reserved for the scrollbar. The same variable that makes the strip
    // pulls the layer's bottom edge up by exactly that much.
    expect(flat(rule(strip, ".playheadLayer"))).toMatch(/bottom: var\(--lane-bottom\);/);
  });
});
