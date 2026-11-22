export interface Box {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface PopoverPlacement {
  left: number;
  top: number;
  /** The most height the popover can take on the chosen side without leaving the viewport. */
  maxHeight: number;
  side: "below" | "above";
}

/** Gap between the anchor and the popover, and the margin kept to the viewport's edges. */
export const POPOVER_GAP = 6;
export const POPOVER_MARGIN = 8;

/**
 * Where a popover goes, in viewport coordinates: below its anchor with the left edges aligned,
 * or above when it does not fit below and the room above is larger (the capture widget sits at
 * the bottom of the screen). Horizontally it stays inside the viewport. `maxHeight` is the room
 * on the chosen side: when even that is too small, the popover is capped to it.
 */
export function placePopover({
  anchor,
  size,
  viewport,
}: {
  anchor: Box;
  size: { width: number; height: number };
  viewport: { width: number; height: number };
}): PopoverPlacement {
  const left = Math.max(
    POPOVER_MARGIN,
    Math.min(anchor.left, viewport.width - size.width - POPOVER_MARGIN),
  );
  const below = viewport.height - anchor.bottom - POPOVER_GAP - POPOVER_MARGIN;
  const above = anchor.top - POPOVER_GAP - POPOVER_MARGIN;
  const side: "below" | "above" =
    size.height <= below
      ? "below"
      : size.height <= above
        ? "above"
        : below >= above
          ? "below"
          : "above";
  const maxHeight = Math.max(0, side === "below" ? below : above);
  const height = Math.min(size.height, maxHeight);
  const top = side === "below" ? anchor.bottom + POPOVER_GAP : anchor.top - POPOVER_GAP - height;
  return { left, top, maxHeight, side };
}
