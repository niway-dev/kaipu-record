import { describe, expect, it } from "vitest";
import {
  WIDGET_EDGE_GAP_DIP,
  WIDGET_MAX_WIDTH_DIP,
  widgetPlacement,
  widgetWidth,
} from "./widget-placement";

// A 1920 × 1055 work area below a 25 DIP menu bar, in window coordinates.
const AREA = { x: 0, y: 25, width: 1920, height: 1055 };
const HEIGHT = 190;

describe("widgetWidth", () => {
  it("is the design width on a wide work area", () => {
    expect(widgetWidth(AREA)).toBe(WIDGET_MAX_WIDTH_DIP);
  });

  it("keeps the design width on a 1280 px work area and shrinks only below it", () => {
    const narrow = { ...AREA, width: 1280 };
    const width = widgetWidth(narrow);
    expect(width).toBeLessThanOrEqual(1280 - 2 * WIDGET_EDGE_GAP_DIP);
    expect(width).toBe(WIDGET_MAX_WIDTH_DIP);
    expect(widgetWidth({ ...AREA, width: 1000 })).toBe(1000 - 2 * WIDGET_EDGE_GAP_DIP);
  });
});

describe("widgetPlacement", () => {
  it("centres the widget 16 DIP above the bottom edge of the work area", () => {
    const box = { x: 400, y: 200, width: 600, height: 400 };
    const placed = widgetPlacement(box, AREA, HEIGHT);
    expect(placed.edge).toBe("bottom");
    expect(placed.top).toBe(AREA.y + AREA.height - WIDGET_EDGE_GAP_DIP - HEIGHT);
    expect(placed.left).toBe((AREA.width - WIDGET_MAX_WIDTH_DIP) / 2);
    expect(placed.width).toBe(WIDGET_MAX_WIDTH_DIP);
  });

  it("stays above the Dock or taskbar because the work area already excludes them", () => {
    const shortArea = { x: 0, y: 0, width: 1440, height: 800 };
    const placed = widgetPlacement({ x: 100, y: 100, width: 300, height: 200 }, shortArea, HEIGHT);
    expect(placed.top + HEIGHT).toBe(shortArea.height - WIDGET_EDGE_GAP_DIP);
  });

  it("jumps to the top, 16 DIP below the work area's top edge, when the box reaches the band", () => {
    const bandTop = AREA.y + AREA.height - WIDGET_EDGE_GAP_DIP - HEIGHT;
    const box = { x: 300, y: 500, width: 800, height: bandTop - 500 + 1 };
    const placed = widgetPlacement(box, AREA, HEIGHT);
    expect(placed.edge).toBe("top");
    expect(placed.top).toBe(AREA.y + WIDGET_EDGE_GAP_DIP);
  });

  it("stays at the bottom when the box ends exactly at the band's top edge", () => {
    const bandTop = AREA.y + AREA.height - WIDGET_EDGE_GAP_DIP - HEIGHT;
    const box = { x: 300, y: 500, width: 800, height: bandTop - 500 };
    expect(widgetPlacement(box, AREA, HEIGHT).edge).toBe("bottom");
  });

  it("returns to the bottom when the box moves back out of the band", () => {
    const low = { x: 300, y: 700, width: 800, height: 380 };
    const high = { x: 300, y: 100, width: 800, height: 380 };
    expect(widgetPlacement(low, AREA, HEIGHT).edge).toBe("top");
    expect(widgetPlacement(high, AREA, HEIGHT).edge).toBe("bottom");
  });

  it("stays at the bottom, covering the strip, when the box also reaches the top band", () => {
    const full = { x: 0, y: AREA.y, width: AREA.width, height: AREA.height };
    const placed = widgetPlacement(full, AREA, HEIGHT);
    expect(placed.edge).toBe("bottom");
    expect(placed.top).toBe(AREA.y + AREA.height - WIDGET_EDGE_GAP_DIP - HEIGHT);
  });

  it("treats a null selection (Screen mode) as the whole work area", () => {
    expect(widgetPlacement(null, AREA, HEIGHT).edge).toBe("bottom");
  });

  it("jumps for a box low on a work area as narrow as the widget, since the band spans it", () => {
    const narrow = { x: 0, y: 0, width: 1000, height: 900 };
    const box = { x: 0, y: 600, width: 200, height: 300 };
    expect(widgetPlacement(box, narrow, HEIGHT).edge).toBe("top");
  });

  it("does not jump for a low box that sits beside the band on a wide work area", () => {
    // The band spans x 400..1520 of 1920; a box at x 0..300 never touches it.
    const box = { x: 0, y: 700, width: 300, height: 380 };
    expect(widgetPlacement(box, AREA, HEIGHT).edge).toBe("bottom");
  });

  it("offsets left by the work area's x on a second display", () => {
    const second = { x: 1920, y: 0, width: 1440, height: 900 };
    const placed = widgetPlacement({ x: 2000, y: 100, width: 400, height: 300 }, second, HEIGHT);
    expect(placed.left).toBe(1920 + (1440 - WIDGET_MAX_WIDTH_DIP) / 2);
  });
});
