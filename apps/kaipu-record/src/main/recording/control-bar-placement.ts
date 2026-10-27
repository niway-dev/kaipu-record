import type { Rect } from "./area-geometry";

/** The bar's distance from the work area's bottom edge when it is not next to an area. */
export const BAR_BOTTOM_MARGIN = 40;
/** The gap between a recorded area's edge (its pink border included) and the bar. */
export const BAR_AREA_GAP = 16;

/**
 * Where the floating control bar goes (global DIP). Design "Kaipu Record Modes": for an area
 * (or a window) the bar sits OUTSIDE the recorded rectangle, so it never covers what is being
 * recorded: centred 16 DIP below it when that fits the work area, otherwise 16 DIP to its
 * right (top-aligned), otherwise to its left. When none fits, and for a whole display, it
 * stays at the bottom centre of the work area as before. The result is clamped to the work
 * area, so the bar is always reachable.
 */
export function controlBarBounds(
  workArea: Rect,
  bar: { width: number; height: number },
  area: Rect | null,
): Rect {
  const clampX = (x: number): number =>
    Math.min(Math.max(x, workArea.x), workArea.x + workArea.width - bar.width);
  const clampY = (y: number): number =>
    Math.min(Math.max(y, workArea.y), workArea.y + workArea.height - bar.height);
  const at = (x: number, y: number): Rect => ({
    x: Math.round(clampX(x)),
    y: Math.round(clampY(y)),
    width: bar.width,
    height: bar.height,
  });
  const bottomCentre = at(
    workArea.x + (workArea.width - bar.width) / 2,
    workArea.y + workArea.height - bar.height - BAR_BOTTOM_MARGIN,
  );
  if (!area) return bottomCentre;

  const below = area.y + area.height + BAR_AREA_GAP;
  if (below + bar.height <= workArea.y + workArea.height) {
    return at(area.x + (area.width - bar.width) / 2, below);
  }
  const right = area.x + area.width + BAR_AREA_GAP;
  if (right + bar.width <= workArea.x + workArea.width) return at(right, area.y);
  const left = area.x - BAR_AREA_GAP - bar.width;
  if (left >= workArea.x) return at(left, area.y);
  return bottomCentre;
}
