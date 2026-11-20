import { describe, expect, it } from "vitest";
import { placePopover, type Box } from "./popover-placement";

const VIEWPORT = { width: 1280, height: 800 };
const anchorAt = (top: number, left = 100, width = 300, height = 56): Box => ({
  top,
  left,
  right: left + width,
  bottom: top + height,
  width,
  height,
});

describe("placePopover", () => {
  it("opens below the anchor, left edges aligned, when it fits", () => {
    const placed = placePopover({
      anchor: anchorAt(200),
      size: { width: 340, height: 300 },
      viewport: VIEWPORT,
    });
    expect(placed.side).toBe("below");
    expect(placed.left).toBe(100);
    expect(placed.top).toBe(200 + 56 + 6);
  });

  it("flips above when there is no room below but there is above (the widget at the bottom)", () => {
    const placed = placePopover({
      anchor: anchorAt(730),
      size: { width: 340, height: 300 },
      viewport: VIEWPORT,
    });
    expect(placed.side).toBe("above");
    // The popover's bottom edge sits one gap above the anchor.
    expect(placed.top + 300).toBe(730 - 6);
  });

  it("keeps the popover inside the viewport horizontally", () => {
    const right = placePopover({
      anchor: anchorAt(100, 1100, 150),
      size: { width: 340, height: 100 },
      viewport: VIEWPORT,
    });
    expect(right.left).toBe(1280 - 340 - 8);
    const left = placePopover({
      anchor: anchorAt(100, -20, 150),
      size: { width: 340, height: 100 },
      viewport: VIEWPORT,
    });
    expect(left.left).toBe(8);
  });

  it("takes the roomier side and caps max-height to it when neither side fits", () => {
    const placed = placePopover({
      anchor: anchorAt(250, 100, 300, 56),
      size: { width: 340, height: 900 },
      viewport: VIEWPORT,
    });
    // 800 - 306 - 6 - 8 = 480 below; 250 - 6 - 8 = 236 above.
    expect(placed.side).toBe("below");
    expect(placed.maxHeight).toBe(480);
  });

  it("never lets a tall popover leave the viewport: top + height stays within the margin", () => {
    for (const top of [40, 150, 300, 450, 600, 744]) {
      const placed = placePopover({
        anchor: anchorAt(top),
        size: { width: 340, height: 460 },
        viewport: VIEWPORT,
      });
      const height = Math.min(460, placed.maxHeight);
      expect(placed.top).toBeGreaterThanOrEqual(8);
      expect(placed.top + height).toBeLessThanOrEqual(800 - 8);
    }
  });

  it("a 400 px popover fits whole at 1280x800 wherever the setup row sits in the window", () => {
    // The Capture page's setup row is the last section: in an 800 px window it sits low enough
    // for the popover to open above it, or high enough to open below.
    for (const top of [120, 200, 300, 440, 500, 600, 700]) {
      const placed = placePopover({
        anchor: anchorAt(top),
        size: { width: 340, height: 400 },
        viewport: VIEWPORT,
      });
      expect(placed.maxHeight).toBeGreaterThanOrEqual(400);
    }
  });
});
