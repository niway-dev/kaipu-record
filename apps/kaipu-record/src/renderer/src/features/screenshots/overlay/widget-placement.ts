import type { CaptureRect } from "@shared/types/screenshot-capture";

/** Gap between the widget and the work area's edge it is docked to, and its side margin. */
export const WIDGET_EDGE_GAP_DIP = 16;
/** The widget's design width; it shrinks to fit a narrower work area. */
export const WIDGET_MAX_WIDTH_DIP = 1120;

export type WidgetEdge = "bottom" | "top";

export interface WidgetPlacement {
  edge: WidgetEdge;
  left: number;
  top: number;
  width: number;
}

/** The widget's width on `area`: the design width, or the area minus a margin on each side. */
export function widgetWidth(area: CaptureRect): number {
  return Math.max(0, Math.min(WIDGET_MAX_WIDTH_DIP, area.width - 2 * WIDGET_EDGE_GAP_DIP));
}

function intersects(a: CaptureRect, b: CaptureRect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/**
 * Where the capture widget goes (ADR 0056): centred at the bottom of the work area, 16 DIP above
 * its edge; at the top, 16 DIP below its edge, when the selection reaches the bottom band and
 * the top band is free; at the bottom (covering that strip) when neither is free. `selection`
 * null is Screen mode, which covers the whole work area. `height` is the widget's measured height.
 * Everything is window-local DIP; `area` is the work area in window coordinates.
 */
export function widgetPlacement(
  selection: CaptureRect | null,
  area: CaptureRect,
  height: number,
): WidgetPlacement {
  const width = widgetWidth(area);
  const left = area.x + (area.width - width) / 2;
  const bottomTop = area.y + area.height - WIDGET_EDGE_GAP_DIP - height;
  const topTop = area.y + WIDGET_EDGE_GAP_DIP;
  const covered = selection ?? area;
  const bottomBand = { x: left, y: bottomTop, width, height };
  const topBand = { x: left, y: topTop, width, height };
  const bottomFree = !intersects(covered, bottomBand);
  const topFree = !intersects(covered, topBand);
  if (!bottomFree && topFree) return { edge: "top", left, top: topTop, width };
  return { edge: "bottom", left, top: bottomTop, width };
}
