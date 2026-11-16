import type { PlacedMedia } from "../media";

/**
 * What the Clips section needs to draw the floating-image rows above the sequence. The page
 * (NIW2-771) builds it from `placeMedia(scene.media, layout)`; `TimelineStrip` and `MediaLane`
 * only draw and report gestures. Every gesture is reported in TIMELINE seconds: the page turns
 * it into an anchor with `moveMedia` / `resizeMediaEdge` (media.ts), never the lane.
 *
 * A drag is one undo step: `onInteractionStart` is called once on pointer down (the page calls
 * `controller.beginInteract()`), `onMove` / `onResizeEdge` are called live while dragging (the
 * page calls `controller.updateLive`), and `onInteractionEnd` once on pointer up
 * (`controller.endInteract()`).
 */
export interface TimelineMedia {
  /** Placed items, lowest z first (the order `placeMedia` returns). */
  placed: PlacedMedia[];
  /** Row of each item id: 1 is just above the sequence, higher is further up (`mediaRows`). */
  rows: Map<string, number>;
  selectedId: string | null;
  /** Object URL of an item's image, for the item's thumbnail; null while it is not loaded. */
  imageUrl(assetId: string): string | null;
  onSelect(id: string | null): void;
  /** Dragging the body: the item should start at this timeline time. */
  onMove(id: string, startTime: number): void;
  /** Dragging an edge: this timeline time is where that edge should be. */
  onResizeEdge(id: string, edge: "start" | "end", time: number): void;
  onInteractionStart(): void;
  onInteractionEnd(): void;
}
